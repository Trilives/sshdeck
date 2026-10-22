//! Blocking execution for one-off SSH commands.
//!
//! Tauri command handlers call this through `spawn_blocking`, so a slow remote command does not occupy
//! the IPC async runtime and freeze the rest of the interface.

use crate::ssh::worker::{Cancel, Worker};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::model::Host;
use crate::ssh::command::build_send_command;
use crate::ssh::process::{apply_askpass, prepare_askpass_helper};
use crate::util::no_window;

/// Run a one-off command and merge stdout/stderr for display in the frontend.
pub fn run_command(
    host: &Host,
    remote_command: &str,
    password: Option<&str>,
    data_dir: &Path,
    cancel: &Cancel,
) -> Result<String, String> {
    let argv = build_send_command(host, remote_command, password.is_some())?;
    let mut process = Command::new(&argv[0]);
    process
        .args(&argv[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(password) = password {
        let helper = prepare_askpass_helper(data_dir)?;
        apply_askpass(&mut process, helper, password);
    }
    no_window(&mut process);
    let (status, mut output) =
        Worker::spawn(&mut process)?.wait(Duration::from_secs(120), cancel)?;
    if !status.success() && output.trim().is_empty() {
        output = format!("exit code {:?}", status.code());
    }
    Ok(output)
}
