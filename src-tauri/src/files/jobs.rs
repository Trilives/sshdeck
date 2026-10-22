use super::{
    filesystem::{join, FileSystem},
    Endpoint,
};
use crate::{
    ssh::{
        command::build_send_command,
        process::{apply_askpass, prepare_askpass_helper},
        sftp::{Attrs, CHUNK},
        worker::{check_cancel, Cancel, Worker},
    },
    util::{lock_error, no_window},
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub source_session: String,
    pub target_session: String,
    pub paths: Vec<String>,
    pub destination: String,
    pub direct: bool,
    pub conflict: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub source: String,
    pub target: String,
    pub destination: String,
    pub status: String,
    pub current_file: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub files_done: usize,
    pub files_total: usize,
    pub skipped: usize,
    pub speed: f64,
    pub direct: bool,
    pub error: String,
}
pub struct Job {
    pub progress: Mutex<Progress>,
    pub cancel: Cancel,
}
impl Job {
    pub fn new(source: &Endpoint, target: &Endpoint, r: &Request) -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
            progress: Mutex::new(Progress {
                id: Uuid::new_v4().to_string(),
                source: source.label(),
                target: target.label(),
                destination: r.destination.clone(),
                status: "queued".into(),
                current_file: String::new(),
                bytes_done: 0,
                bytes_total: 0,
                files_done: 0,
                files_total: 0,
                skipped: 0,
                speed: 0.,
                direct: r.direct,
                error: String::new(),
            }),
        }
    }
    pub fn update(&self, app: Option<&AppHandle>, f: impl FnOnce(&mut Progress)) {
        if let Ok(mut p) = self.progress.lock() {
            f(&mut p);
            if let Some(app) = app {
                let _ = app.emit("file-transfer", p.clone());
            }
        }
    }
}

struct Item {
    source: String,
    relative: Vec<String>,
    attrs: Attrs,
}
fn basename(path: &str, local: bool) -> Result<String, String> {
    let p = if local {
        path.trim_end_matches(['\\', '/'])
    } else {
        path.trim_end_matches('/')
    };
    p.rsplit(if local { &['\\', '/'][..] } else { &['/'][..] })
        .next()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Cannot transfer a filesystem root".into())
}
fn scan(
    fs: &mut FileSystem,
    path: String,
    relative: Vec<String>,
    out: &mut Vec<Item>,
    cancel: &Cancel,
) -> Result<(), String> {
    check_cancel(cancel)?;
    if relative.len() > 128 || out.len() > 200000 {
        return Err("Directory tree is too large or too deep".into());
    }
    let a = fs
        .stat(&path)?
        .ok_or_else(|| format!("Source missing: {path}"))?;
    if a.is_link() || (!a.is_file() && !a.is_dir()) {
        return Err(format!(
            "Symbolic links and special files are not copied / 暂不复制符号链接或特殊文件: {path}"
        ));
    }
    let dir = a.is_dir();
    out.push(Item {
        source: path.clone(),
        relative: relative.clone(),
        attrs: a,
    });
    if dir {
        for e in fs.list(&path)? {
            let mut r = relative.clone();
            r.push(e.name);
            scan(fs, e.path, r, out, cancel)?;
        }
    }
    Ok(())
}
fn target_path(root: &str, relative: &[String], local: bool) -> Result<String, String> {
    relative
        .iter()
        .try_fold(root.to_string(), |p, n| join(&p, n, local))
}
fn contains_path(parent: &str, child: &str, local: bool) -> bool {
    let norm = |s: &str| {
        if local {
            s.replace('\\', "/").to_lowercase()
        } else {
            s.to_string()
        }
    };
    let a = norm(parent).trim_end_matches('/').to_string();
    let b = norm(child).trim_end_matches('/').to_string();
    b == a || b.starts_with(&(a + "/"))
}
fn renamed(fs: &mut FileSystem, path: &str) -> Result<String, String> {
    for i in 1..10000 {
        let next = format!("{path} ({i})");
        if fs.stat(&next)?.is_none() {
            return Ok(next);
        }
    }
    Err("Cannot find a free filename".into())
}

// Quotes for the source host's POSIX shell and for its sftp batch parser are separate layers.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
fn batch_quote(s: &str) -> Result<String, String> {
    if s.contains(['\n', '\r', '\0']) {
        return Err("Direct mode cannot transfer filenames with line breaks".into());
    }
    Ok(format!(
        "\"{}\"",
        s.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('*', "\\*")
            .replace('?', "\\?")
            .replace('[', "\\[")
    ))
}
fn direct_command(target: &crate::model::Host) -> Result<String, String> {
    let host = target.ssh_host.trim();
    let user = target.ssh_user.trim();
    if host.starts_with('-')
        || host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_:%[]".contains(c))
        || !user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-@".contains(c))
    {
        return Err("Direct mode requires a host name/IP and a standard SSH user".into());
    }
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let destination = if user.is_empty() {
        host
    } else {
        format!("{user}@{host}")
    };
    let port = target
        .ssh_port
        .trim()
        .parse::<u16>()
        .map_err(|_| "Invalid destination port")?;
    if port == 0 {
        return Err("Invalid destination port".into());
    }
    Ok(format!("sftp -b - -P {port} -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -- {}",shell_quote(&destination)))
}
fn direct_file(
    source: &Endpoint,
    target: &Endpoint,
    source_path: &str,
    temp: &str,
    fs: &mut FileSystem,
    data_dir: &Path,
    cancel: &Cancel,
    mut progress: impl FnMut(u64),
) -> Result<(), String> {
    let remote = direct_command(
        target
            .host
            .as_ref()
            .ok_or("Direct mode requires two remote hosts")?,
    )?;
    let argv = build_send_command(
        source
            .host
            .as_ref()
            .ok_or("Direct mode requires two remote hosts")?,
        &remote,
        source.password.is_some(),
    )?;
    let mut cmd = Command::new(&argv[0]);
    cmd.args(&argv[1..]).stdin(Stdio::piped());
    no_window(&mut cmd);
    if let Some(password) = &source.password {
        apply_askpass(&mut cmd, prepare_askpass_helper(data_dir)?, password);
    }
    let batch = format!("put {} {}\n", batch_quote(source_path)?, batch_quote(temp)?);
    let mut worker = Worker::spawn(&mut cmd)?;
    let mut stdin = worker
        .child
        .stdin
        .take()
        .ok_or("Missing direct transfer stdin")?;
    // Also bound control writes: a broken network must not block cancellation.
    thread::spawn(move || {
        let _ = stdin.write_all(batch.as_bytes());
    });
    let mut last_change = Instant::now();
    let mut last_size = 0;
    loop {
        check_cancel(cancel)?;
        if let Some(status) = worker.child.try_wait().map_err(|e| e.to_string())? {
            let (status, output) = worker.finish(status);
            return if status.success() {
                Ok(())
            } else {
                Err(format!("Direct transfer failed / 直连传输失败：源主机需安装 sftp，并能免密登录且信任目标主机。\n{output}"))
            };
        }
        if let Some(a) = fs.stat(temp)? {
            progress(a.size);
            if a.size != last_size {
                last_change = Instant::now();
                last_size = a.size;
            }
        }
        if last_change.elapsed() > Duration::from_secs(120) {
            return Err("Direct transfer stalled / 直连传输超过 120 秒无进展".into());
        }
        for _ in 0..5 {
            check_cancel(cancel)?;
            thread::sleep(Duration::from_millis(100));
        }
    }
}

pub fn run(
    job: &Arc<Job>,
    r: &Request,
    source: &Endpoint,
    target: &Endpoint,
    data_dir: &Path,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    check_cancel(&job.cancel)?;
    job.update(app, |p| p.status = "scanning".into());
    if r.paths.is_empty()
        || r.paths.len() > 10000
        || !["skip", "overwrite", "rename"].contains(&r.conflict.as_str())
    {
        return Err("Invalid transfer request".into());
    }
    if r.direct && (source.host.is_none() || target.host.is_none()) {
        return Err("Direct mode requires two remote hosts".into());
    }
    let mut src = FileSystem::connect(source, data_dir, job.cancel.clone())?;
    let mut dst = FileSystem::connect(target, data_dir, job.cancel.clone())?;
    let root = dst.realpath(&r.destination)?;
    if !dst.stat(&root)?.is_some_and(|a| a.is_dir()) {
        return Err("Destination must be a directory".into());
    }
    let mut manifest = Vec::new();
    let mut chosen = Vec::<String>::new();
    // Canonicalize user-selected paths and remove children already covered by an ancestor.
    for path in &r.paths {
        let a = src
            .stat(path)?
            .ok_or_else(|| format!("Source missing: {path}"))?;
        if a.is_link() {
            return Err(format!("Symbolic links are not copied: {path}"));
        }
        let path = src.realpath(path)?;
        if source.same_host(target)
            && contains_path(
                &path,
                &join(&root, &basename(&path, src.is_local())?, dst.is_local())?,
                src.is_local(),
            )
        {
            return Err("Cannot copy a file onto itself or a folder into itself / 不能复制到自身或自己的子目录".into());
        }
        if chosen
            .iter()
            .any(|p| contains_path(p, &path, src.is_local()))
        {
            continue;
        }
        chosen.retain(|p| !contains_path(&path, p, src.is_local()));
        chosen.push(path);
    }
    for path in chosen {
        let name = basename(&path, src.is_local())?;
        scan(&mut src, path, vec![name], &mut manifest, &job.cancel)?;
    }
    // Validate the complete destination tree before creating anything.
    for item in &manifest {
        target_path(&root, &item.relative, dst.is_local())?;
    }
    let total = manifest
        .iter()
        .filter(|i| i.attrs.is_file())
        .map(|i| i.attrs.size)
        .sum();
    let count = manifest.iter().filter(|i| i.attrs.is_file()).count();
    job.update(app, |p| {
        p.status = "running".into();
        p.bytes_total = total;
        p.files_total = count;
    });
    let start = Instant::now();
    let mut last_emit = Instant::now();
    let mut done = 0u64;
    let mut actual = 0u64;
    for item in manifest {
        check_cancel(&job.cancel)?;
        let mut dest = target_path(&root, &item.relative, dst.is_local())?;
        if item.attrs.is_dir() {
            dst.mkdir(&dest)?;
            continue;
        }
        if let Some(a) = dst.stat(&dest)? {
            if !a.is_file() {
                return Err(format!("Target is not a regular file: {dest}"));
            }
            if r.conflict == "skip" {
                done += item.attrs.size;
                job.update(app, |p| {
                    p.skipped += 1;
                    p.files_done += 1;
                    p.bytes_done = done;
                });
                continue;
            }
            if r.conflict == "rename" {
                dest = renamed(&mut dst, &dest)?;
            }
        }
        let parent = if dst.is_local() {
            Path::new(&dest)
                .parent()
                .ok_or("Invalid target path")?
                .to_string_lossy()
                .to_string()
        } else {
            dest.rsplit_once('/')
                .map(|(p, _)| if p.is_empty() { "/" } else { p })
                .ok_or("Invalid target path")?
                .into()
        };
        let temp = join(
            &parent,
            &format!(".sshdeck-{}.part", Uuid::new_v4()),
            dst.is_local(),
        )?;
        job.update(app, |p| {
            p.current_file = item.relative.join("/");
            p.bytes_done = done;
        });
        let result: Result<(), String> = (|| {
            let mut report = |n: u64| {
                if last_emit.elapsed() >= Duration::from_millis(200) {
                    let n = n.min(item.attrs.size);
                    job.update(app, |p| {
                        p.bytes_done = done + n;
                        p.speed = (actual + n) as f64 / start.elapsed().as_secs_f64().max(0.001);
                    });
                    last_emit = Instant::now();
                }
            };
            if r.direct {
                direct_file(
                    source,
                    target,
                    &item.source,
                    &temp,
                    &mut dst,
                    data_dir,
                    &job.cancel,
                    &mut report,
                )?;
                let size = dst
                    .stat(&temp)?
                    .ok_or("Direct transfer did not create the file")?
                    .size;
                if size != item.attrs.size {
                    return Err(
                        "Source file changed during transfer / 传输期间源文件大小发生变化".into(),
                    );
                }
            } else {
                let mut input = src.open(&item.source, false)?;
                let mut output = dst.open(&temp, true)?;
                let copied: Result<(), String> = (|| {
                    let mut offset = 0;
                    while offset < item.attrs.size {
                        check_cancel(&job.cancel)?;
                        let b = src.read(
                            &mut input,
                            offset,
                            ((CHUNK * 16) as u64).min(item.attrs.size - offset) as usize,
                        )?;
                        if b.is_empty() {
                            return Err(
                                "Source file changed during transfer / 传输期间源文件被截断".into(),
                            );
                        }
                        dst.write(&mut output, offset, &b)?;
                        offset += b.len() as u64;
                        report(offset);
                    }
                    if !src.read(&mut input, offset, 1)?.is_empty() {
                        return Err(
                            "Source file grew during transfer / 传输期间源文件大小发生变化".into(),
                        );
                    }
                    Ok(())
                })();
                let close_in = src.close(input);
                let close_out = dst.close(output);
                copied?;
                close_in?;
                close_out?;
            }
            check_cancel(&job.cancel)?;
            dst.preserve(&temp, &item.attrs)?;
            dst.commit(&temp, &dest, r.conflict == "overwrite")?;
            Ok(())
        })();
        if result.is_err() {
            dst.reset_cancel();
            let _ = dst.remove(&temp);
        }
        result?;
        done += item.attrs.size;
        actual += item.attrs.size;
        job.update(app, |p| {
            p.files_done += 1;
            p.bytes_done = done;
            p.speed = actual as f64 / start.elapsed().as_secs_f64().max(0.001);
        });
    }
    Ok(())
}

pub fn snapshot(job: &Job) -> Result<Progress, String> {
    job.progress.lock().map(|p| p.clone()).map_err(lock_error)
}
pub fn cancel(job: &Job) {
    job.cancel.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shell_and_batch_quotes_cannot_inject_commands() {
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
        assert!(batch_quote("x\n!rm").is_err());
        assert_eq!(batch_quote("a\"*.zip").unwrap(), "\"a\\\"\\*.zip\"");
    }
    #[test]
    fn containment_honors_boundaries_and_windows_case() {
        assert!(contains_path("C:\\Data", "c:/data/sub", true));
        assert!(!contains_path("/data", "/database", false));
        assert!(!contains_path("/Data", "/data", false));
    }
    #[test]
    fn direct_mode_does_not_send_local_identity_or_proxy_options() {
        let h = crate::model::Host {
            ssh_host: "::1".into(),
            ssh_user: "dev".into(),
            identity_file: "C:\\secret".into(),
            proxy_jump: "local-jump".into(),
            ..Default::default()
        };
        let cmd = direct_command(&h).unwrap();
        assert!(cmd.contains("dev@[::1]"));
        assert!(!cmd.contains("secret"));
        assert!(!cmd.contains("local-jump"));
        assert!(cmd.contains("StrictHostKeyChecking=yes"));
    }
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("sshdeck-test-{}", Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            // Tests own only this newly generated directory under the system temporary directory.
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("sshdeck-test-"));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn local_request(paths: Vec<String>, destination: &Path) -> Request {
        Request {
            source_session: "test".into(),
            target_session: "test".into(),
            paths,
            destination: destination.to_string_lossy().into(),
            direct: false,
            conflict: "skip".into(),
        }
    }
    fn local_run(r: &Request) -> Result<Progress, String> {
        let e = Endpoint {
            host: None,
            password: None,
        };
        let j = Arc::new(Job::new(&e, &e, r));
        run(&j, r, &e, &e, &std::env::temp_dir(), None)?;
        snapshot(&j)
    }
    #[test]
    fn copies_nested_unicode_empty_and_multiblock_files_and_deduplicates_selection() {
        let t = Temp::new();
        let source = t.0.join("版本 1");
        let target = t.0.join("target");
        std::fs::create_dir_all(source.join("nested")).unwrap();
        std::fs::create_dir(&target).unwrap();
        let data: Vec<u8> = (0..800123).map(|i| (i % 251) as u8).collect();
        std::fs::write(source.join("nested").join("数据.bin"), &data).unwrap();
        std::fs::write(source.join("empty"), []).unwrap();
        let r = local_request(
            vec![
                source.join("nested").to_string_lossy().into(),
                source.to_string_lossy().into(),
            ],
            &target,
        );
        let p = local_run(&r).unwrap();
        assert_eq!(
            std::fs::read(target.join("版本 1/nested/数据.bin")).unwrap(),
            data
        );
        assert_eq!(
            std::fs::metadata(target.join("版本 1/empty"))
                .unwrap()
                .len(),
            0
        );
        assert_eq!(p.files_total, 2);
        assert_eq!(p.files_done, 2);
        assert_eq!(p.bytes_done, 800123);
    }
    #[test]
    fn conflict_policies_preserve_skip_overwrite_and_keep_both() {
        let t = Temp::new();
        let source = t.0.join("file.txt");
        let target = t.0.join("target");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(&source, "new content").unwrap();
        std::fs::write(target.join("file.txt"), "original").unwrap();
        let mut r = local_request(vec![source.to_string_lossy().into()], &target);
        assert_eq!(local_run(&r).unwrap().skipped, 1);
        assert_eq!(
            std::fs::read_to_string(target.join("file.txt")).unwrap(),
            "original"
        );
        r.conflict = "rename".into();
        local_run(&r).unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("file.txt (1)")).unwrap(),
            "new content"
        );
        r.conflict = "overwrite".into();
        local_run(&r).unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("file.txt")).unwrap(),
            "new content"
        );
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 2); // no leaked .part files
    }
    #[test]
    fn refuses_copy_into_itself_and_rejects_direct_local() {
        let t = Temp::new();
        let source = t.0.join("source");
        std::fs::create_dir(&source).unwrap();
        let mut r = local_request(vec![source.to_string_lossy().into()], &source);
        assert!(local_run(&r).unwrap_err().contains("itself"));
        r.direct = true;
        assert!(local_run(&r).unwrap_err().contains("two remote hosts"));
    }
    #[test]
    fn pre_cancelled_job_never_creates_destination_files() {
        let t = Temp::new();
        let source = t.0.join("file");
        let target = t.0.join("target");
        std::fs::write(&source, "data").unwrap();
        std::fs::create_dir(&target).unwrap();
        let e = Endpoint {
            host: None,
            password: None,
        };
        let r = local_request(vec![source.to_string_lossy().into()], &target);
        let j = Arc::new(Job::new(&e, &e, &r));
        cancel(&j);
        assert!(run(&j, &r, &e, &e, &t.0, None)
            .unwrap_err()
            .contains("cancelled"));
        assert_eq!(std::fs::read_dir(target).unwrap().count(), 0);
    }
}
