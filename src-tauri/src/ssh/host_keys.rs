use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{model::Host, ssh::command::build_host_key_check, util::no_window};

use super::worker::Worker;

static UPDATE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct HostFingerprint {
    endpoint: String,
    fingerprint: String,
}

struct RejectedKey {
    display: HostFingerprint,
    host: Host,
    algorithm: String,
    known_hosts: PathBuf,
    original: String,
    offending_line: Option<usize>,
    hash_known_hosts: bool,
}

fn run(program: &str, args: &[String]) -> Result<(bool, String), String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .env("LC_ALL", "C")
        .env("SSH_ASKPASS_REQUIRE", "never");
    no_window(&mut cmd);
    let (status, output) = Worker::spawn(&mut cmd)?
        .wait(Duration::from_secs(14), &Arc::new(AtomicBool::new(false)))?;
    Ok((status.success(), output))
}

fn ssh_config(host: &Host) -> Result<String, String> {
    let mut args = build_host_key_check(host, &[])?;
    args.insert(0, "-G".into());
    let (ok, output) = run("ssh", &args)?;
    if ok {
        Ok(output)
    } else {
        Err(output)
    }
}

fn setting<'a>(config: &'a str, name: &str) -> Option<&'a str> {
    config.lines().find_map(|line| line.strip_prefix(name))
}

fn jump_host(value: &str, previous: &[&str], config_option: &str) -> Result<Host, String> {
    let value = value.strip_prefix("ssh://").unwrap_or(value);
    let (user, endpoint) = value.rsplit_once('@').unwrap_or(("", value));
    let (name, port) = if let Some(bracketed) = endpoint.strip_prefix('[') {
        let (name, rest) = bracketed
            .split_once(']')
            .ok_or("Invalid ProxyJump address.")?;
        (name, rest.strip_prefix(':').unwrap_or(rest))
    } else if endpoint.matches(':').count() == 1 {
        endpoint.split_once(':').unwrap()
    } else {
        (endpoint, "")
    };
    if name.is_empty() || (!port.is_empty() && port.parse::<u16>().is_err()) {
        return Err("Invalid ProxyJump address.".into());
    }
    Ok(Host {
        ssh_host: name.into(),
        ssh_port: port.into(),
        ssh_user: user.into(),
        proxy_jump: previous.join(","),
        extra_options: config_option.into(),
        ..Host::default()
    })
}

fn known_hosts_entry(config: &str) -> Result<String, String> {
    if let Some(alias) = setting(config, "hostkeyalias ") {
        return Ok(alias.into());
    }
    let host = setting(config, "hostname ").ok_or("OpenSSH did not report the host name.")?;
    let port = setting(config, "port ").ok_or("OpenSSH did not report the port.")?;
    Ok(if port == "22" {
        host.into()
    } else {
        format!("[{host}]:{port}")
    })
}

fn path_for_ssh(path: &Path) -> String {
    let path = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        path.replace('\\', "/")
    } else {
        path
    }
}

fn normalized_path(path: &str) -> String {
    if cfg!(windows) {
        path.replace('\\', "/").to_ascii_lowercase()
    } else {
        path.into()
    }
}

fn verify_known_key(endpoint: &str, output: &str) -> Result<(), String> {
    let matched = format!("debug1: Host '{endpoint}' is known and matches the ");
    if output.lines().any(|line| line.starts_with(&matched)) {
        return Ok(());
    }
    let detail = output
        .lines()
        .filter(|line| !line.starts_with("debug") && !line.starts_with("OpenSSH_"))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Err(super::diagnose::format_failure(
        &format!("Unable to verify the SSH fingerprint for {endpoint}."),
        &detail,
    ))
}

fn check(host: &Host, config: &str, ssh_home: &Path) -> Result<Option<RejectedKey>, String> {
    let endpoint = known_hosts_entry(config)?;
    let first = ssh_home.join("known_hosts");
    let second = ssh_home.join("known_hosts2");
    let snapshots = [&first, &second].map(|path| (path, read_known_hosts(path)));
    let args = build_host_key_check(host, &["StrictHostKeyChecking=yes".into()])?;
    let (_, output) = run("ssh", &args)?;
    let changed = output
        .lines()
        .any(|line| line.starts_with(&format!("Host key for {endpoint} has changed")));
    let unknown = output.lines().any(|line| {
        line.starts_with("No ")
            && line.ends_with(&format!(
                "host key is known for {endpoint} and you have requested strict checking."
            ))
    });
    if !changed && !unknown {
        verify_known_key(&endpoint, &output)?;
        return Ok(None);
    }
    let error = "OpenSSH did not report a verifiable host key for this endpoint.";
    let fingerprint = output
        .lines()
        .filter_map(|line| {
            line.trim()
                .strip_prefix("debug1: Server host key: ")
                .and_then(|key| key.split_whitespace().nth(1))
        })
        .last()
        .filter(|fingerprint| fingerprint.starts_with("SHA256:"))
        .ok_or(error)?;
    let algorithm = output
        .lines()
        .filter_map(|line| {
            line.trim()
                .strip_prefix("debug1: kex: host key algorithm: ")
        })
        .last()
        .filter(|algorithm| {
            !algorithm.is_empty()
                && algorithm
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_@.".contains(&c))
        })
        .ok_or(error)?;

    let manual = "This fingerprint uses a custom or system-wide known_hosts file. Verify it and update it in OpenSSH.";
    let (known_hosts, original, offending_line, was_hashed) = if changed {
        let (file, line) = output
            .lines()
            .rev()
            .find_map(|line| {
                let (_, location) = line.strip_prefix("Offending ")?.split_once(" key in ")?;
                let (file, line) = location.rsplit_once(':')?;
                Some((normalized_path(file), line.parse::<usize>().ok()?))
            })
            .ok_or(manual)?;
        let (path, original) = snapshots
            .into_iter()
            .find(|(path, _)| normalized_path(&path_for_ssh(path)) == file)
            .ok_or(manual)?;
        let original = original?;
        let hashed = original
            .lines()
            .nth(line.saturating_sub(1))
            .is_some_and(|row| row.starts_with("|1|"));
        (path.clone(), original, Some(line), hashed)
    } else {
        let configured =
            normalized_path(setting(config, "userknownhostsfile ").unwrap_or_default());
        let first_name = normalized_path(&path_for_ssh(&first));
        configured
            .strip_prefix(&first_name)
            .filter(|s| s.is_empty() || s.starts_with(' '))
            .ok_or(manual)?;
        let [(path, original), _] = snapshots;
        (path.clone(), original?, None, false)
    };
    Ok(Some(RejectedKey {
        display: HostFingerprint {
            endpoint,
            fingerprint: fingerprint.into(),
        },
        host: host.clone(),
        algorithm: algorithm.into(),
        known_hosts,
        original,
        offending_line,
        hash_known_hosts: was_hashed || setting(config, "hashknownhosts ") == Some("yes"),
    }))
}

fn inspect_route(host: &Host, ssh_home: &Path) -> Result<Option<RejectedKey>, String> {
    let config = ssh_config(host)?;
    let jumps = setting(&config, "proxyjump ")
        .filter(|spec| *spec != "none")
        .unwrap_or_default();
    let route: Vec<_> = jumps
        .split(',')
        .map(str::trim)
        .filter(|hop| !hop.is_empty())
        .collect();
    let mut config_option = String::new();
    let mut extra = shell_words::split(&host.extra_options)
        .map_err(|error| error.to_string())?
        .into_iter();
    while let Some(arg) = extra.next() {
        if let Some(file) = arg.strip_prefix("-F") {
            let file = if file.is_empty() {
                extra.next().unwrap_or_default()
            } else {
                file.into()
            };
            config_option = shell_words::join(["-F", &file]);
        }
    }
    for (index, hop) in route.iter().enumerate() {
        let jump = jump_host(hop, &route[..index], &config_option)?;
        if let Some(key) = check(&jump, &ssh_config(&jump)?, ssh_home)? {
            return Ok(Some(key));
        }
    }
    check(host, &config, ssh_home)
}

fn ssh_home() -> Result<PathBuf, String> {
    directories::BaseDirs::new()
        .map(|dirs| dirs.home_dir().join(".ssh"))
        .ok_or_else(|| "Cannot locate the OpenSSH home directory.".into())
}

pub fn fingerprint(host: &Host) -> Result<Option<HostFingerprint>, String> {
    Ok(inspect_route(host, &ssh_home()?)?.map(|key| key.display))
}

fn read_known_hosts(path: &Path) -> Result<String, String> {
    if fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.is_file()) {
        return Err("The OpenSSH known_hosts path must be a regular file.".into());
    }
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updating_one_key_preserves_shared_aliases_and_other_records() {
        let original = "# keep\r\n[host]:2222,another ssh-rsa old\r\nother ssh-ed25519 other-key";
        let result =
            patched_known_hosts(original, "[host]:2222", Some(2), "[host]:2222 ssh-rsa new")
                .unwrap();
        assert_eq!(result, "# keep\r\nanother ssh-rsa old\r\nother ssh-ed25519 other-key\n[host]:2222 ssh-rsa new\n");
        assert!(patched_known_hosts("*.example ssh-rsa old", "host.example", Some(1), "").is_err());
        assert!(patched_known_hosts("", "host.example", Some(1), "").is_err());
    }

    #[test]
    fn parses_ipv6_jump_ports_and_retains_preceding_hops() {
        let jump = jump_host("ssh://dev@[2001:db8::1]:2222", &["first"], "-F config").unwrap();
        assert_eq!(jump.ssh_user, "dev");
        assert_eq!(jump.ssh_host, "2001:db8::1");
        assert_eq!(jump.ssh_port, "2222");
        assert_eq!(jump.proxy_jump, "first");
        assert_eq!(jump.extra_options, "-F config");
    }

    #[test]
    fn only_a_matching_endpoint_counts_as_verified() {
        let jump = "debug1: Host 'jump' is known and matches the ED25519 host key.\n";
        assert!(verify_known_key("jump", jump).is_ok());
        assert!(verify_known_key("target", jump).is_err());
        assert!(verify_known_key(
            "jump",
            "ssh: connect to host jump port 22: Connection refused"
        )
        .is_err());
    }
}

fn capture_key(key: &RejectedKey, path: &Path) -> Result<String, String> {
    let options = [
        "StrictHostKeyChecking=accept-new".into(),
        format!("UserKnownHostsFile=\"{}\"", path_for_ssh(path)),
        "GlobalKnownHostsFile=none".into(),
        "KnownHostsCommand=none".into(),
        "VerifyHostKeyDNS=no".into(),
        "CheckHostIP=no".into(),
        format!(
            "HashKnownHosts={}",
            if key.hash_known_hosts { "yes" } else { "no" }
        ),
        format!("HostKeyAlgorithms={}", key.algorithm),
    ];
    let args = build_host_key_check(&key.host, &options)?;
    run("ssh", &args)?;
    let candidate = read_known_hosts(path)?;
    let row = candidate.trim_end();
    let error = "The confirmed host key could not be captured with that fingerprint.";
    if row.is_empty() || row.lines().count() != 1 {
        return Err(error.into());
    }
    let (found, _) = run(
        "ssh-keygen",
        &[
            "-F".into(),
            key.display.endpoint.clone(),
            "-f".into(),
            path_for_ssh(path),
        ],
    )?;
    let (ok, fingerprints) = run("ssh-keygen", &["-lf".into(), path_for_ssh(path)])?;
    if !found || !ok || fingerprints.split_whitespace().nth(1) != Some(&key.display.fingerprint) {
        return Err(error.into());
    }
    Ok(row.into())
}

fn patched_known_hosts(
    original: &str,
    endpoint: &str,
    offending_line: Option<usize>,
    replacement: &str,
) -> Result<String, String> {
    let error = "The old known_hosts entry changed or uses a pattern. Review it in OpenSSH.";
    let mut edited = String::with_capacity(original.len() + replacement.len() + 2);
    let mut removed = offending_line.is_none();
    for (index, line) in original.split_inclusive('\n').enumerate() {
        if offending_line != Some(index + 1) {
            edited.push_str(line);
            continue;
        }
        let (hosts, rest) = line.split_once(char::is_whitespace).ok_or(error)?;
        if !hosts.starts_with("|1|") {
            let aliases: Vec<_> = hosts
                .split(',')
                .filter(|host| !host.eq_ignore_ascii_case(endpoint))
                .collect();
            if aliases.len() == hosts.split(',').count() {
                return Err(error.into());
            }
            if !aliases.is_empty() {
                edited.push_str(&aliases.join(","));
                edited.push_str(&line[hosts.len()..line.len() - rest.len()]);
                edited.push_str(rest);
            }
        }
        removed = true;
    }
    if !removed {
        return Err(error.into());
    }
    if !edited.is_empty() && !edited.ends_with('\n') {
        edited.push('\n');
    }
    edited.push_str(replacement);
    edited.push('\n');
    Ok(edited)
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(windows)]
fn replace_known_hosts(staged: &Path, known_hosts: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{MoveFileW, ReplaceFileW, REPLACE_FILE_FLAGS},
    };

    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain([0])
            .collect::<Vec<_>>()
    };
    let source = wide(staged);
    let destination = wide(known_hosts);
    if !known_hosts.exists() {
        // MoveFileW does not overwrite a file OpenSSH might have just created.
        return unsafe { MoveFileW(PCWSTR(source.as_ptr()), PCWSTR(destination.as_ptr())) }
            .map_err(|error| error.to_string());
    }
    let backup = known_hosts.with_extension(format!("sshdeck-{}.bak", Uuid::new_v4()));
    let backup_name = wide(&backup);
    // ReplaceFileW preserves the original file's DACL. Keep a recovery copy if
    // Windows moved the original but could not finish installing the update.
    let result = unsafe {
        ReplaceFileW(
            PCWSTR(destination.as_ptr()),
            PCWSTR(source.as_ptr()),
            PCWSTR(backup_name.as_ptr()),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    };
    match result {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(error) if backup.exists() && !known_hosts.exists() => {
            match fs::rename(&backup, known_hosts) {
                Ok(()) => Err(error.to_string()),
                Err(restore) => Err(format!(
                    "{error}. Could not restore {}: {restore}. The original file is at {}.",
                    known_hosts.display(),
                    backup.display()
                )),
            }
        }
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(not(windows))]
fn replace_known_hosts(staged: &Path, known_hosts: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::metadata(known_hosts) {
        fs::set_permissions(staged, metadata.permissions()).map_err(|error| error.to_string())?;
    }
    fs::rename(staged, known_hosts).map_err(|error| error.to_string())
}

pub fn trust(host: &Host, confirmed: &HostFingerprint) -> Result<(), String> {
    trust_in_home(host, confirmed, &ssh_home()?)
}

fn trust_in_home(host: &Host, confirmed: &HostFingerprint, ssh_home: &Path) -> Result<(), String> {
    let _guard = UPDATE_LOCK.lock().map_err(crate::util::lock_error)?;
    let key = inspect_route(host, ssh_home)?
        .ok_or("The SSH fingerprint is already trusted. Check the route again.")?;
    if key.display != *confirmed {
        return Err(
            "The SSH fingerprint changed again. Reconnect and verify the new fingerprint.".into(),
        );
    }
    if read_known_hosts(&key.known_hosts)? != key.original {
        return Err(
            "known_hosts changed while checking the fingerprint. Reconnect and try again.".into(),
        );
    }
    fs::create_dir_all(ssh_home).map_err(|error| error.to_string())?;
    let candidate = TemporaryFile(ssh_home.join(format!("sshdeck-{}.key", Uuid::new_v4())));
    let replacement = capture_key(&key, &candidate.0)?;
    let updated = patched_known_hosts(
        &key.original,
        &key.display.endpoint,
        key.offending_line,
        &replacement,
    )?;
    let staged = TemporaryFile(ssh_home.join(format!("sshdeck-{}.tmp", Uuid::new_v4())));
    fs::write(&staged.0, updated).map_err(|error| error.to_string())?;
    if read_known_hosts(&key.known_hosts)? != key.original {
        return Err(
            "known_hosts changed while checking the fingerprint. Reconnect and try again.".into(),
        );
    }
    replace_known_hosts(&staged.0, &key.known_hosts)
}
