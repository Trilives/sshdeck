//! SFTP v3 over the user's OpenSSH transport, preserving SSH config, agents and ProxyJump.
//! Protocol: https://www.ietf.org/archive/id/draft-ietf-secsh-filexfer-02.txt
use crate::{
    model::Host,
    ssh::{
        command::build_send_command,
        process::{apply_askpass, prepare_askpass_helper},
        worker::{check_cancel, Cancel},
    },
    util::no_window,
};
use std::{
    io::{Cursor, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{atomic::AtomicBool, mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const MAX_PACKET: usize = 4 * 1024 * 1024;
pub const CHUNK: usize = 32 * 1024;

pub fn u32buf(buf: &mut Vec<u8>, n: u32) {
    buf.extend_from_slice(&n.to_be_bytes());
}
pub fn string(buf: &mut Vec<u8>, s: &[u8]) {
    u32buf(buf, s.len() as u32);
    buf.extend_from_slice(s);
}
struct Decoder(Cursor<Vec<u8>>);
impl Decoder {
    fn byte(&mut self) -> Result<u8, String> {
        let mut b = [0];
        self.0.read_exact(&mut b).map_err(|e| e.to_string())?;
        Ok(b[0])
    }
    fn u32(&mut self) -> Result<u32, String> {
        let mut b = [0; 4];
        self.0.read_exact(&mut b).map_err(|e| e.to_string())?;
        Ok(u32::from_be_bytes(b))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let mut b = [0; 8];
        self.0.read_exact(&mut b).map_err(|e| e.to_string())?;
        Ok(u64::from_be_bytes(b))
    }
    fn bytes(&mut self) -> Result<Vec<u8>, String> {
        let len = self.u32()? as usize;
        if len > MAX_PACKET
            || len
                > self
                    .0
                    .get_ref()
                    .len()
                    .saturating_sub(self.0.position() as usize)
        {
            return Err("Invalid SFTP string length".into());
        }
        let mut b = vec![0; len];
        self.0.read_exact(&mut b).map_err(|e| e.to_string())?;
        Ok(b)
    }
    fn text(&mut self) -> Result<String, String> {
        String::from_utf8(self.bytes()?)
            .map_err(|_| "Non-UTF8 remote filenames are unsupported".into())
    }
    fn attrs(&mut self) -> Result<Attrs, String> {
        let flags = self.u32()?;
        let size = if flags & 1 != 0 { self.u64()? } else { 0 };
        if flags & 2 != 0 {
            self.u32()?;
            self.u32()?;
        }
        let permissions = if flags & 4 != 0 { self.u32()? } else { 0 };
        let modified = if flags & 8 != 0 {
            self.u32()?;
            self.u32()? as u64
        } else {
            0
        };
        if flags & 0x80000000 != 0 {
            for _ in 0..self.u32()? {
                self.bytes()?;
                self.bytes()?;
            }
        }
        Ok(Attrs {
            size,
            permissions,
            modified,
        })
    }
}

#[derive(Clone, Debug, Default)]
pub struct Attrs {
    pub size: u64,
    pub permissions: u32,
    pub modified: u64,
}
impl Attrs {
    pub fn is_dir(&self) -> bool {
        self.permissions & 0o170000 == 0o040000
    }
    pub fn is_link(&self) -> bool {
        self.permissions & 0o170000 == 0o120000
    }
    pub fn is_file(&self) -> bool {
        self.permissions & 0o170000 == 0o100000
    }
}

pub struct Sftp {
    child: Option<Child>,
    send: Option<mpsc::Sender<Vec<u8>>>,
    receive: mpsc::Receiver<Result<Vec<u8>, String>>,
    stderr: Arc<Mutex<Vec<u8>>>,
    cancel: Cancel,
    next: u32,
    posix_rename: bool,
    timeout: Duration,
}

impl Sftp {
    pub fn connect(
        host: &Host,
        password: Option<&str>,
        data_dir: &Path,
        cancel: Cancel,
    ) -> Result<Self, String> {
        let mut argv = build_send_command(host, "sftp", password.is_some())?;
        // The final argument is the subsystem, not a remote shell command.
        argv.insert(1, "-s".into());
        let mut cmd = Command::new(&argv[0]);
        cmd.args(&argv[1..])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut cmd);
        if let Some(password) = password {
            apply_askpass(&mut cmd, prepare_askpass_helper(data_dir)?, password);
        }
        Self::from_command(&mut cmd, cancel)
    }

    fn from_command(cmd: &mut Command, cancel: Cancel) -> Result<Self, String> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let mut stdin = child.stdin.take().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let mut err = child.stderr.take().unwrap();
        let (tx, writer) = mpsc::channel::<Vec<u8>>();
        thread::spawn(move || {
            for frame in writer {
                if stdin.write_all(&frame).is_err() || stdin.flush().is_err() {
                    break;
                }
            }
        });
        let (reader, rx) = mpsc::sync_channel(32);
        thread::spawn(move || loop {
            let frame = (|| {
                let mut size = [0; 4];
                stdout.read_exact(&mut size).map_err(|e| e.to_string())?;
                let len = u32::from_be_bytes(size) as usize;
                if len == 0 || len > MAX_PACKET {
                    return Err("Invalid SFTP packet size".into());
                }
                let mut packet = vec![0; len];
                stdout.read_exact(&mut packet).map_err(|e| e.to_string())?;
                Ok(packet)
            })();
            let failed = frame.is_err();
            if reader.send(frame).is_err() || failed {
                break;
            }
        });
        let stderr = Arc::new(Mutex::new(Vec::new()));
        let errbuf = stderr.clone();
        thread::spawn(move || {
            let mut b = [0; 4096];
            while let Ok(n) = err.read(&mut b) {
                if n == 0 {
                    break;
                }
                if let Ok(mut v) = errbuf.lock() {
                    let keep = n.min(16384usize.saturating_sub(v.len()));
                    v.extend_from_slice(&b[..keep]);
                }
            }
        });
        let mut s = Self {
            child: Some(child),
            send: Some(tx),
            receive: rx,
            stderr,
            cancel,
            next: 0,
            posix_rename: false,
            timeout: Duration::from_secs(30),
        };
        s.frame(vec![1, 0, 0, 0, 3])?;
        let mut version = s.packet()?;
        if version.byte()? != 2 || version.u32()? != 3 {
            return Err("This server does not support SFTP v3".into());
        }
        while version.0.position() < version.0.get_ref().len() as u64 {
            let name = version.text()?;
            version.bytes()?;
            if name == "posix-rename@openssh.com" {
                s.posix_rename = true;
            }
        }
        Ok(s)
    }
    fn frame(&mut self, packet: Vec<u8>) -> Result<(), String> {
        check_cancel(&self.cancel)?;
        let mut frame = Vec::with_capacity(packet.len() + 4);
        u32buf(&mut frame, packet.len() as u32);
        frame.extend(packet);
        self.send
            .as_ref()
            .unwrap()
            .send(frame)
            .map_err(|_| "SFTP connection closed".into())
    }
    fn packet(&mut self) -> Result<Decoder, String> {
        let start = Instant::now();
        loop {
            check_cancel(&self.cancel)?;
            match self.receive.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(p)) => return Ok(Decoder(Cursor::new(p))),
                Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // Give the stderr drainer a chance to publish the authentication diagnostic.
                    thread::sleep(Duration::from_millis(30));
                    let err = self
                        .stderr
                        .lock()
                        .map(|v| String::from_utf8_lossy(&v).to_string())
                        .unwrap_or_default();
                    return Err(format!("SFTP connection closed / SFTP 连接已关闭\n{err}"));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if start.elapsed() > self.timeout {
                return Err("SFTP timed out / SFTP 响应超时".into());
            }
        }
    }
    fn send_request(&mut self, kind: u8, payload: Vec<u8>) -> Result<u32, String> {
        self.next = self.next.wrapping_add(1);
        let mut packet = vec![kind];
        u32buf(&mut packet, self.next);
        packet.extend(payload);
        self.frame(packet)?;
        Ok(self.next)
    }
    fn response(&mut self, id: u32) -> Result<(u8, Decoder), String> {
        let mut d = self.packet()?;
        let kind = d.byte()?;
        if d.u32()? != id {
            return Err("Unexpected SFTP response id".into());
        }
        Ok((kind, d))
    }
    fn request(&mut self, kind: u8, payload: Vec<u8>) -> Result<(u8, Decoder), String> {
        let id = self.send_request(kind, payload)?;
        self.response(id)
    }
    fn status(kind: u8, mut d: Decoder) -> Result<(), String> {
        if kind != 101 {
            return Err(format!("Unexpected SFTP response {kind}"));
        }
        let code = d.u32()?;
        let message = d.text()?;
        if code == 0 {
            Ok(())
        } else {
            Err(format!("SFTP {code}: {message}"))
        }
    }
    fn path_request(&mut self, kind: u8, path: &str) -> Result<(u8, Decoder), String> {
        let mut p = Vec::new();
        string(&mut p, path.as_bytes());
        self.request(kind, p)
    }
    pub fn realpath(&mut self, path: &str) -> Result<String, String> {
        let (kind, mut d) = self.path_request(16, path)?;
        if kind != 104 {
            Self::status(kind, d)?;
            return Err("Missing canonical path".into());
        }
        if d.u32()? != 1 {
            return Err("Invalid canonical path response".into());
        }
        d.text()
    }
    pub fn stat(&mut self, path: &str) -> Result<Option<Attrs>, String> {
        let (kind, mut d) = self.path_request(7, path)?; // LSTAT: do not follow symlinks.
        if kind == 105 {
            return Ok(Some(d.attrs()?));
        }
        if kind == 101 {
            let code = d.u32()?;
            if code == 2 {
                return Ok(None);
            }
            return Err(format!("SFTP {code}: {}", d.text()?));
        }
        Err("Invalid stat response".into())
    }
    pub fn list(&mut self, path: &str) -> Result<Vec<(String, Attrs)>, String> {
        let (kind, mut d) = self.path_request(11, path)?;
        if kind != 102 {
            Self::status(kind, d)?;
            return Err("Missing directory handle".into());
        }
        let handle = d.bytes()?;
        let result = (|| {
            let mut entries = Vec::new();
            loop {
                let mut p = Vec::new();
                string(&mut p, &handle);
                let (kind, mut d) = self.request(12, p)?;
                if kind == 101 {
                    if d.u32()? == 1 {
                        break;
                    }
                    return Err(d.text()?);
                }
                if kind != 104 {
                    return Err("Invalid directory response".into());
                }
                let count = d.u32()?;
                if count > 100000 {
                    return Err("Directory response too large".into());
                }
                for _ in 0..count {
                    let name = d.text()?;
                    d.bytes()?;
                    let attrs = d.attrs()?;
                    if name != "." && name != ".." {
                        if name.contains('/') || name.contains('\0') {
                            return Err("Invalid filename from SFTP server".into());
                        }
                        entries.push((name, attrs));
                    }
                }
                if entries.len() > 100000 {
                    return Err("Directory has over 100,000 entries".into());
                }
            }
            Ok(entries)
        })();
        let closed = self.close(&handle);
        let entries = result?;
        closed?;
        Ok(entries)
    }
    pub fn open(&mut self, path: &str, write: bool) -> Result<Vec<u8>, String> {
        let mut p = Vec::new();
        string(&mut p, path.as_bytes());
        u32buf(&mut p, if write { 2 | 8 | 32 } else { 1 }); // exclusive create for temporary files
        u32buf(&mut p, if write { 4 } else { 0 });
        if write {
            u32buf(&mut p, 0o600);
        }
        let (kind, mut d) = self.request(3, p)?;
        if kind == 102 {
            d.bytes()
        } else {
            Self::status(kind, d)?;
            Err("Missing file handle".into())
        }
    }
    pub fn close(&mut self, handle: &[u8]) -> Result<(), String> {
        let mut p = Vec::new();
        string(&mut p, handle);
        let (k, d) = self.request(4, p)?;
        Self::status(k, d)
    }
    pub fn read(&mut self, handle: &[u8], offset: u64, len: usize) -> Result<Vec<u8>, String> {
        let mut p = Vec::new();
        string(&mut p, handle);
        p.extend(offset.to_be_bytes());
        u32buf(&mut p, len as u32);
        let (kind, mut d) = self.request(5, p)?;
        if kind == 103 {
            let b = d.bytes()?;
            return if b.len() <= len {
                Ok(b)
            } else {
                Err("Oversized SFTP read response".into())
            };
        }
        if kind == 101 {
            let code = d.u32()?;
            if code == 1 {
                return Ok(Vec::new());
            }
            return Err(format!("SFTP {code}: {}", d.text()?));
        }
        Err("SFTP read failed".into())
    }
    // A bounded window avoids paying one network round trip for every 32 KB.
    // Servers may reply out of order or return short reads; handle both explicitly.
    pub fn read_window(
        &mut self,
        handle: &[u8],
        offset: u64,
        len: usize,
    ) -> Result<Vec<u8>, String> {
        let mut requests = std::collections::HashMap::new();
        let mut pieces: Vec<Vec<u8>> = Vec::new();
        let mut lengths = Vec::new();
        for start in (0..len).step_by(CHUNK) {
            let size = CHUNK.min(len - start);
            let mut p = Vec::new();
            string(&mut p, handle);
            p.extend((offset + start as u64).to_be_bytes());
            u32buf(&mut p, size as u32);
            let id = self.send_request(5, p)?;
            requests.insert(id, pieces.len());
            pieces.push(Vec::new());
            lengths.push(size);
        }
        while !requests.is_empty() {
            let mut d = self.packet()?;
            let kind = d.byte()?;
            let id = d.u32()?;
            let i = requests.remove(&id).ok_or("Unexpected SFTP read id")?;
            if kind == 103 {
                pieces[i] = d.bytes()?;
                if pieces[i].len() > lengths[i] {
                    return Err("Oversized SFTP read".into());
                }
            } else if kind == 101 {
                let code = d.u32()?;
                return Err(format!("SFTP {code}: {}", d.text()?));
            } else {
                return Err("Invalid SFTP read response".into());
            }
        }
        let mut out = Vec::with_capacity(len);
        for (i, mut piece) in pieces.into_iter().enumerate() {
            while piece.len() < lengths[i] {
                let more = self.read(
                    handle,
                    offset + (i * CHUNK + piece.len()) as u64,
                    lengths[i] - piece.len(),
                )?;
                if more.is_empty() {
                    return Err("Source file was truncated during transfer".into());
                }
                piece.extend(more);
            }
            out.extend(piece);
        }
        Ok(out)
    }
    pub fn write_window(&mut self, handle: &[u8], offset: u64, data: &[u8]) -> Result<(), String> {
        let mut requests = std::collections::HashSet::new();
        for (i, chunk) in data.chunks(CHUNK).enumerate() {
            let mut p = Vec::new();
            string(&mut p, handle);
            p.extend((offset + (i * CHUNK) as u64).to_be_bytes());
            string(&mut p, chunk);
            requests.insert(self.send_request(6, p)?);
        }
        while !requests.is_empty() {
            let mut d = self.packet()?;
            let kind = d.byte()?;
            let id = d.u32()?;
            if !requests.remove(&id) {
                return Err("Unexpected SFTP write id".into());
            }
            Self::status(kind, d)?;
        }
        Ok(())
    }
    pub fn mkdir(&mut self, path: &str) -> Result<(), String> {
        if let Some(attrs) = self.stat(path)? {
            return if attrs.is_dir() {
                Ok(())
            } else {
                Err(format!("Not a directory: {path}"))
            };
        }
        let mut p = Vec::new();
        string(&mut p, path.as_bytes());
        u32buf(&mut p, 4);
        u32buf(&mut p, 0o755);
        let (k, d) = self.request(14, p)?;
        Self::status(k, d)
    }
    pub fn remove(&mut self, path: &str) -> Result<(), String> {
        let (k, d) = self.path_request(13, path)?;
        Self::status(k, d)
    }
    pub fn rename(&mut self, from: &str, to: &str, replace: bool) -> Result<(), String> {
        let mut p = Vec::new();
        let kind = if replace && self.posix_rename {
            string(&mut p, b"posix-rename@openssh.com");
            200
        } else {
            18
        };
        string(&mut p, from.as_bytes());
        string(&mut p, to.as_bytes());
        let (k, d) = self.request(kind, p)?;
        Self::status(k, d)
    }
    pub fn set_attrs(&mut self, path: &str, attrs: &Attrs) -> Result<(), String> {
        let mut p = Vec::new();
        string(&mut p, path.as_bytes());
        u32buf(&mut p, 4 | 8);
        u32buf(&mut p, attrs.permissions & 0o777);
        u32buf(&mut p, attrs.modified as u32);
        u32buf(&mut p, attrs.modified as u32);
        let (k, d) = self.request(9, p)?;
        Self::status(k, d)
    }
    pub fn reset_cancel(&mut self) {
        self.cancel = Arc::new(AtomicBool::new(false));
        self.timeout = Duration::from_secs(1);
    }
}
impl Drop for Sftp {
    fn drop(&mut self) {
        self.send.take();
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_truncated_or_huge_strings() {
        for data in [vec![255, 255, 255, 255], vec![0, 0, 0, 4, 1]] {
            assert!(Decoder(Cursor::new(data)).bytes().is_err());
        }
    }
    #[test]
    fn decodes_attributes_without_following_links() {
        let mut b = Vec::new();
        u32buf(&mut b, 1 | 2 | 4 | 8);
        b.extend(123u64.to_be_bytes());
        u32buf(&mut b, 1000);
        u32buf(&mut b, 1000);
        u32buf(&mut b, 0o120777);
        u32buf(&mut b, 1);
        u32buf(&mut b, 42);
        let a = Decoder(Cursor::new(b)).attrs().unwrap();
        assert_eq!(a.size, 123);
        assert_eq!(a.modified, 42);
        assert!(a.is_link());
        assert!(!a.is_dir());
    }
    fn mock() -> (
        Sftp,
        mpsc::Receiver<Vec<u8>>,
        mpsc::Sender<Result<Vec<u8>, String>>,
    ) {
        let (tx, writer) = mpsc::channel();
        let (reader, rx) = mpsc::channel();
        (
            Sftp {
                child: None,
                send: Some(tx),
                receive: rx,
                stderr: Arc::new(Mutex::new(Vec::new())),
                cancel: Arc::new(AtomicBool::new(false)),
                next: 0,
                posix_rename: false,
                timeout: Duration::from_secs(2),
            },
            writer,
            reader,
        )
    }
    #[test]
    fn window_handles_out_of_order_packets_and_short_reads() {
        let (mut s, requests, responses) = mock();
        let server = thread::spawn(move || {
            let mut batch = Vec::new();
            for _ in 0..3 {
                batch.push(requests.recv().unwrap());
            }
            for (i, frame) in batch.into_iter().rev().enumerate() {
                let mut d = Decoder(Cursor::new(frame[4..].to_vec()));
                assert_eq!(d.byte().unwrap(), 5);
                let id = d.u32().unwrap();
                d.bytes().unwrap();
                let offset = d.u64().unwrap();
                let len = d.u32().unwrap() as usize;
                let len = if i == 0 { len / 2 } else { len };
                let data: Vec<u8> = (offset..offset + len as u64)
                    .map(|v| (v % 251) as u8)
                    .collect();
                let mut p = vec![103];
                u32buf(&mut p, id);
                string(&mut p, &data);
                responses.send(Ok(p)).unwrap();
            }
            let frame = requests.recv().unwrap();
            let mut d = Decoder(Cursor::new(frame[4..].to_vec()));
            assert_eq!(d.byte().unwrap(), 5);
            let id = d.u32().unwrap();
            d.bytes().unwrap();
            let offset = d.u64().unwrap();
            let len = d.u32().unwrap();
            let data: Vec<u8> = (offset..offset + len as u64)
                .map(|v| (v % 251) as u8)
                .collect();
            let mut p = vec![103];
            u32buf(&mut p, id);
            string(&mut p, &data);
            responses.send(Ok(p)).unwrap();
        });
        let result = s.read_window(b"file", 100, CHUNK * 2 + 111).unwrap();
        assert_eq!(
            result,
            (100..100 + (CHUNK * 2 + 111) as u64)
                .map(|v| (v % 251) as u8)
                .collect::<Vec<_>>()
        );
        server.join().unwrap();
    }
    #[test]
    fn window_matches_out_of_order_write_acknowledgements() {
        let (mut s, requests, responses) = mock();
        let data = vec![42; CHUNK * 2 + 7];
        let server = thread::spawn(move || {
            let mut ids = Vec::new();
            let mut written = Vec::new();
            for i in 0..3 {
                let frame = requests.recv().unwrap();
                let mut d = Decoder(Cursor::new(frame[4..].to_vec()));
                assert_eq!(d.byte().unwrap(), 6);
                ids.push(d.u32().unwrap());
                d.bytes().unwrap();
                assert_eq!(d.u64().unwrap(), (i * CHUNK) as u64);
                written.extend(d.bytes().unwrap());
            }
            for id in ids.into_iter().rev() {
                let mut p = vec![101];
                u32buf(&mut p, id);
                u32buf(&mut p, 0);
                string(&mut p, b"OK");
                string(&mut p, b"");
                responses.send(Ok(p)).unwrap();
            }
            written
        });
        s.write_window(b"file", 0, &data).unwrap();
        assert_eq!(server.join().unwrap(), data);
    }

    #[test]
    fn interoperates_with_openssh_sftp_server() {
        let server = std::env::var_os("SSHDECK_SFTP_SERVER")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from("C:\\Program Files\\Git\\usr\\lib\\ssh\\sftp-server.exe")
            });
        if !server.is_file() {
            eprintln!("Set SSHDECK_SFTP_SERVER to run the OpenSSH interoperability test");
            return;
        }
        let root = std::env::temp_dir().join(format!("sshdeck-sftp-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let result = (|| -> Result<(), String> {
            let mut cmd = Command::new(&server);
            cmd.current_dir(&root);
            if let Some(bin) = server
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.join("bin"))
            {
                let mut paths = vec![bin];
                paths.extend(std::env::split_paths(
                    &std::env::var_os("PATH").unwrap_or_default(),
                ));
                cmd.env("PATH", std::env::join_paths(paths).unwrap());
            }
            no_window(&mut cmd);
            let mut s = Sftp::from_command(&mut cmd, Arc::new(AtomicBool::new(false)))?;
            let base = s.realpath(".")?;
            let folder = format!("{base}/folder");
            s.mkdir(&folder)?;
            let file = format!("{folder}/数据.bin");
            let handle = s.open(&file, true)?;
            let data: Vec<u8> = (0..170123).map(|i| (i % 251) as u8).collect();
            s.write_window(&handle, 0, &data)?;
            s.close(&handle)?;
            let a = s.stat(&file)?.ok_or("Missing uploaded file")?;
            assert!(a.is_file());
            assert_eq!(a.size, data.len() as u64);
            let handle = s.open(&file, false)?;
            let downloaded = s.read_window(&handle, 0, data.len())?;
            s.close(&handle)?;
            assert_eq!(downloaded, data);
            let listed = s.list(&folder)?;
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].0, "数据.bin");
            s.set_attrs(
                &file,
                &Attrs {
                    modified: 1700000000,
                    permissions: 0o100600,
                    ..a
                },
            )?;
            let final_path = format!("{folder}/committed.bin");
            s.rename(&file, &final_path, false)?;
            let replacement = format!("{folder}/replacement.part");
            let h = s.open(&replacement, true)?;
            s.write_window(&h, 0, b"replacement")?;
            s.close(&h)?;
            assert!(s.posix_rename);
            s.rename(&replacement, &final_path, true)?;
            assert_eq!(s.stat(&final_path)?.unwrap().size, 11);
            s.remove(&final_path)?;
            assert!(s.stat(&final_path)?.is_none());
            Ok(())
        })();
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("sshdeck-sftp-test-"));
        let _ = std::fs::remove_dir_all(&root);
        result.unwrap();
    }
}
