use std::process::{Command, Stdio};

use tauri::AppHandle;

use crate::model::Host;
use crate::ssh::command::build_probe_command;
use crate::ssh::diagnose::{classify_ssh_failure, format_failure, SshFailureKind};
use crate::ssh::worker::Worker;
use crate::state::AppState;
use crate::util::no_window;
use std::{
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

/// Probe the connection, returning "ready" / "password_required" / "host_key_changed", or an unreachable error.
pub fn probe_connection(host: &Host, state: &AppState, app: &AppHandle) -> Result<String, String> {
    let command = build_probe_command(host)?;
    state.add_log(
        "debug",
        format!("[{}] probe $ {}", host.name, command.join(" ")),
        Some(app),
    );
    let mut process = Command::new(&command[0]);
    process
        .args(&command[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    no_window(&mut process);
    let (status, stderr) = Worker::spawn(&mut process)?
        .wait(Duration::from_secs(20), &Arc::new(AtomicBool::new(false)))?;
    if status.success() {
        return Ok("ready".to_string());
    }

    match classify_ssh_failure(&stderr) {
        SshFailureKind::HostKeyChanged => Ok("host_key_changed".to_string()),
        // Connected to the host but passwordless isn't available / auth failed → show a password prompt.
        SshFailureKind::AuthRequired => Ok("password_required".to_string()),
        // Host unreachable / bad IP / port / network issue → error out with the reason directly, don't treat it as needing a password.
        other => Err(format_failure(other.reason(state.is_zh()), &stderr)),
    }
}
