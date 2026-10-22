//! Bounded, cancellable child processes. Never run these waits on the webview thread.
use std::{
    collections::{HashMap, VecDeque},
    io::Read,
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub type Cancel = Arc<AtomicBool>;

#[derive(Default)]
pub struct CommandRuns {
    pub active: Mutex<HashMap<String, Cancel>>,
    cancelled_before_start: Mutex<VecDeque<String>>,
}

impl CommandRuns {
    pub fn register(&self, id: &str) -> Result<Cancel, String> {
        let mut active = self.active.lock().map_err(crate::util::lock_error)?;
        let mut pending = self
            .cancelled_before_start
            .lock()
            .map_err(crate::util::lock_error)?;
        if let Some(index) = pending.iter().position(|p| p == id) {
            pending.remove(index);
            return Err("Operation cancelled / 操作已取消".into());
        }
        if active.contains_key(id) {
            return Err("Command already running".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        active.insert(id.to_string(), cancel.clone());
        Ok(cancel)
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let active = self.active.lock().map_err(crate::util::lock_error)?;
        if let Some(cancel) = active.get(id) {
            cancel.store(true, Ordering::Relaxed);
        } else {
            let mut pending = self
                .cancelled_before_start
                .lock()
                .map_err(crate::util::lock_error)?;
            if !pending.iter().any(|p| p == id) {
                pending.push_back(id.to_string());
            }
            if pending.len() > 256 {
                pending.pop_front();
            }
        }
        Ok(())
    }
}

pub fn check_cancel(cancel: &Cancel) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Operation cancelled / 操作已取消".into())
    } else {
        Ok(())
    }
}

// Drain both pipes concurrently, even after the display limit is reached (otherwise ssh can deadlock).
fn capture(mut pipe: impl Read + Send + 'static) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut result = Vec::new();
        let mut buf = [0; 8192];
        while let Ok(n) = pipe.read(&mut buf) {
            if n == 0 {
                break;
            }
            let keep = n.min((1024 * 1024usize).saturating_sub(result.len()));
            result.extend_from_slice(&buf[..keep]);
        }
        let _ = tx.send(result);
    });
    rx
}

pub struct Worker {
    pub child: Child,
    stdout: mpsc::Receiver<Vec<u8>>,
    stderr: mpsc::Receiver<Vec<u8>>,
}

impl Worker {
    pub fn spawn(command: &mut Command) -> Result<Self, String> {
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let stdout = capture(child.stdout.take().unwrap());
        let stderr = capture(child.stderr.take().unwrap());
        Ok(Self {
            child,
            stdout,
            stderr,
        })
    }

    pub fn finish(&mut self, status: ExitStatus) -> (ExitStatus, String) {
        let out = self
            .stdout
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or_default();
        let err = self
            .stderr
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or_default();
        let mut text = String::from_utf8_lossy(&out).trim_end().to_owned();
        if !err.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(String::from_utf8_lossy(&err).trim_end());
        }
        if out.len() >= 1024 * 1024 || err.len() >= 1024 * 1024 {
            text.push_str("\n[Output truncated / 输出已截断]");
        }
        (status, text)
    }

    pub fn wait(
        &mut self,
        timeout: Duration,
        cancel: &Cancel,
    ) -> Result<(ExitStatus, String), String> {
        let start = Instant::now();
        loop {
            check_cancel(cancel)?;
            if let Some(status) = self.child.try_wait().map_err(|e| e.to_string())? {
                return Ok(self.finish(status));
            }
            if start.elapsed() >= timeout {
                return Err(
                    "Operation timed out / 操作超时，请检查网络或在终端运行长时间指令".into(),
                );
            }
            thread::sleep(Duration::from_millis(40));
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn early_cancellation_cannot_be_lost_by_ipc_scheduling() {
        let runs = CommandRuns::default();
        runs.cancel("early").unwrap();
        assert!(runs.register("early").unwrap_err().contains("cancelled"));
        assert!(runs.active.lock().unwrap().is_empty());
        let cancel = runs.register("running").unwrap();
        runs.cancel("running").unwrap();
        assert!(cancel.load(Ordering::Relaxed));
    }
    fn shell(script: &str) -> Command {
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        crate::util::no_window(&mut cmd);
        cmd
    }
    #[test]
    fn slow_process_times_out_and_is_reaped() {
        let mut worker = Worker::spawn(&mut shell("Start-Sleep -Seconds 10")).unwrap();
        let start = Instant::now();
        assert!(worker
            .wait(
                Duration::from_millis(100),
                &Arc::new(AtomicBool::new(false))
            )
            .unwrap_err()
            .contains("timed out"));
        drop(worker);
        assert!(start.elapsed() < Duration::from_secs(3));
    }
    #[test]
    fn cancellation_does_not_wait_for_child() {
        let mut worker = Worker::spawn(&mut shell("Start-Sleep -Seconds 10")).unwrap();
        assert!(worker
            .wait(Duration::from_secs(30), &Arc::new(AtomicBool::new(true)))
            .unwrap_err()
            .contains("cancelled"));
    }
    #[test]
    fn drains_and_caps_large_output() {
        let mut worker = Worker::spawn(&mut shell(
            "[Console]::Out.Write(('x' * 1200000)); [Console]::Error.Write('stderr')",
        ))
        .unwrap();
        let (status, output) = worker
            .wait(Duration::from_secs(15), &Arc::new(AtomicBool::new(false)))
            .unwrap();
        assert!(status.success());
        assert!(output.contains("stderr"));
        assert!(output.ends_with("[Output truncated / 输出已截断]"));
        assert!(output.len() < 1050000);
    }
}
