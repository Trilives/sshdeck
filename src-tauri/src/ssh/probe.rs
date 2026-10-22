use std::{
    io::Write,
    process::{Command, Stdio},
};

use tauri::AppHandle;

use crate::model::Host;
use crate::ssh::command::build_probe_command;
use crate::ssh::diagnose::{classify_ssh_failure, format_failure, SshFailureKind};
use crate::ssh::worker::Worker;
use crate::state::AppState;
use crate::util::{empty_default, no_window};
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

pub fn get_host_fingerprint(host: &Host) -> Result<String, String> {
    let port = empty_default(&host.ssh_port, "22");
    let target = host.ssh_host.trim();

    let mut scan = Command::new("ssh-keyscan");
    scan.args(["-T", "5", "-p", port, target])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    no_window(&mut scan);
    let scan_output = scan.output().map_err(|err| err.to_string())?;
    if scan_output.stdout.is_empty() {
        return Err("Cannot fetch host key.".to_string());
    }

    let mut keygen = Command::new("ssh-keygen");
    keygen
        .args(["-l", "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut keygen);
    let mut child = keygen.spawn().map_err(|err| err.to_string())?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(&scan_output.stdout)
            .map_err(|err| err.to_string())?;
    }
    let output = child.wait_with_output().map_err(|err| err.to_string())?;
    let fingerprint = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if fingerprint.is_empty() {
        return Err("Cannot compute host key fingerprint.".to_string());
    }
    Ok(fingerprint)
}

pub fn remove_known_host(host: &Host, state: &AppState, app: &AppHandle) -> Result<(), String> {
    let target = host.ssh_host.trim().to_string();
    if target.is_empty() {
        return Err("SSH host is required.".to_string());
    }
    let port = empty_default(&host.ssh_port, "22").to_string();
    let mut targets = vec![target.clone()];
    if port != "22" {
        targets.push(format!("[{target}]:{port}"));
    }
    for entry in targets {
        let mut keygen = Command::new("ssh-keygen");
        keygen
            .args(["-R", &entry])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        no_window(&mut keygen);
        match keygen.output() {
            Ok(_) => state.add_log(
                "info",
                format!("[{}] removed old host key for {}", host.name, entry),
                Some(app),
            ),
            Err(err) => state.add_log(
                "warning",
                format!("[{}] ssh-keygen -R {} failed: {}", host.name, entry, err),
                Some(app),
            ),
        }
    }
    Ok(())
}
