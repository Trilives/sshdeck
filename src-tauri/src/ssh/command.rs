use crate::model::{Forward, Host, TunnelMode};
use crate::util::empty_default;

/// `user@host`, or just `host` if no user is set.
pub fn destination(host: &Host) -> String {
    if host.ssh_user.trim().is_empty() {
        host.ssh_host.trim().to_string()
    } else {
        format!("{}@{}", host.ssh_user.trim(), host.ssh_host.trim())
    }
}

fn push_identity_and_extra(host: &Host, command: &mut Vec<String>) -> Result<(), String> {
    if !host.identity_file.trim().is_empty() {
        command.extend(["-i".to_string(), host.identity_file.trim().to_string()]);
    }
    if !host.extra_options.trim().is_empty() {
        command.extend(shell_words::split(&host.extra_options).map_err(|err| err.to_string())?);
    }
    Ok(())
}

/// Jump host: adds `-J <proxyJump>` when non-empty. Must come before destination.
fn push_proxy_jump(host: &Host, command: &mut Vec<String>) {
    if !host.proxy_jump.trim().is_empty() {
        command.extend(["-J".to_string(), host.proxy_jump.trim().to_string()]);
    }
}

/// Background port-forward command: `ssh -N -T … -L/-R/-D … user@host`.
pub fn build_ssh_command(host: &Host, forward: &Forward) -> Result<Vec<String>, String> {
    let mut command = vec![
        "ssh".to_string(),
        "-N".to_string(),
        "-T".to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=30".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-p".to_string(),
        empty_default(&host.ssh_port, "22").to_string(),
    ];
    push_identity_and_extra(host, &mut command)?;
    push_proxy_jump(host, &mut command);

    let bind = empty_default(&forward.bind_host, "127.0.0.1");
    match forward.mode {
        TunnelMode::Local => command.extend([
            "-L".to_string(),
            format!(
                "{}:{}:{}:{}",
                bind,
                forward.bind_port.trim(),
                empty_default(&forward.target_host, "127.0.0.1"),
                forward.target_port.trim()
            ),
        ]),
        TunnelMode::Remote => command.extend([
            "-R".to_string(),
            format!(
                "{}:{}:{}:{}",
                bind,
                forward.bind_port.trim(),
                empty_default(&forward.target_host, "127.0.0.1"),
                forward.target_port.trim()
            ),
        ]),
        TunnelMode::Dynamic => command.extend([
            "-D".to_string(),
            format!("{}:{}", bind, forward.bind_port.trim()),
        ]),
    }
    command.push(destination(host));
    Ok(command)
}

/// Probe command: `BatchMode=yes`, to distinguish passwordless / password-required / fingerprint-changed / unreachable.
pub fn build_probe_command(host: &Host) -> Result<Vec<String>, String> {
    let mut command = vec![
        "ssh".to_string(),
        "-T".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=8".to_string(),
        "-o".to_string(),
        "NumberOfPasswordPrompts=0".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-p".to_string(),
        empty_default(&host.ssh_port, "22").to_string(),
    ];
    push_identity_and_extra(host, &mut command)?;
    push_proxy_jump(host, &mut command);
    command.push(destination(host));
    command.push("exit 0".to_string());
    Ok(command)
}

/// Upload-public-key command (allows interactive password entry).
pub fn build_key_upload_command(host: &Host) -> Result<Vec<String>, String> {
    let mut command = vec![
        "ssh".to_string(),
        "-T".to_string(),
        "-o".to_string(),
        "BatchMode=no".to_string(),
        "-o".to_string(),
        "ConnectTimeout=8".to_string(),
        "-o".to_string(),
        "NumberOfPasswordPrompts=1".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=5".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-p".to_string(),
        empty_default(&host.ssh_port, "22").to_string(),
    ];
    if !host.identity_file.trim().is_empty() {
        command.extend(["-i".to_string(), host.identity_file.trim().to_string()]);
    }
    push_proxy_jump(host, &mut command);
    command.push(destination(host));
    command.push(
        "umask 077; mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && key=$(cat) && { grep -qxF -- \"$key\" ~/.ssh/authorized_keys || printf '\\n%s\\n' \"$key\" >> ~/.ssh/authorized_keys; }"
            .to_string(),
    );
    Ok(command)
}

/// Send a one-off command. With `with_password=false`, uses `BatchMode=yes` (relies on passwordless login);
/// with `with_password=true`, allows a password (paired with askpass injection).
pub fn build_send_command(
    host: &Host,
    remote_command: &str,
    with_password: bool,
) -> Result<Vec<String>, String> {
    let batch_mode = if with_password {
        "BatchMode=no"
    } else {
        "BatchMode=yes"
    };
    let prompts = if with_password {
        "NumberOfPasswordPrompts=1"
    } else {
        "NumberOfPasswordPrompts=0"
    };
    let mut command = vec![
        "ssh".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=5".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
        "-T".to_string(),
        "-o".to_string(),
        batch_mode.to_string(),
        "-o".to_string(),
        "ConnectTimeout=8".to_string(),
        "-o".to_string(),
        prompts.to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-p".to_string(),
        empty_default(&host.ssh_port, "22").to_string(),
    ];
    push_identity_and_extra(host, &mut command)?;
    push_proxy_jump(host, &mut command);
    command.push(destination(host));
    command.push(remote_command.to_string());
    Ok(command)
}

/// ssh args for the interactive terminal (excludes `ssh` itself, which is assembled separately later).
/// When `path` is a non-empty remote directory, allocate a pty (`-t`) and `cd` into it before dropping
/// into an interactive login shell (falling back to the home dir if the path is gone).
pub fn build_terminal_args(host: &Host, path: Option<&str>) -> Result<Vec<String>, String> {
    let mut command = vec![
        "ssh".to_string(),
        "-p".to_string(),
        empty_default(&host.ssh_port, "22").to_string(),
    ];
    push_identity_and_extra(host, &mut command)?;
    push_proxy_jump(host, &mut command);

    let path = path.map(str::trim).filter(|p| !p.is_empty());
    if path.is_some() {
        // A pty is required for the interactive login shell we launch after cd'ing.
        command.push("-t".to_string());
    }
    command.push(destination(host));
    if let Some(path) = path {
        // Single-quote the path (escaping embedded quotes) so spaces/special chars survive the remote shell.
        // A non-login interactive shell keeps the cwd we just cd'd into (a login shell's profile might reset it).
        let quoted = format!("'{}'", path.replace('\'', "'\\''"));
        command.push(format!(
            "cd {quoted} 2>/dev/null; exec \"${{SHELL:-/bin/bash}}\""
        ));
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_forward_keeps_proxy_jump_before_forward_and_destination() {
        let host = Host {
            ssh_host: "10.0.0.8".to_string(),
            ssh_user: "dev".to_string(),
            proxy_jump: "jump@203.0.113.8:2222".to_string(),
            ..Host::default()
        };
        let forward = Forward {
            mode: TunnelMode::Local,
            bind_host: "127.0.0.1".to_string(),
            bind_port: "8080".to_string(),
            target_host: "127.0.0.1".to_string(),
            target_port: "80".to_string(),
            ..Forward::default()
        };

        let command = build_ssh_command(&host, &forward).unwrap();
        let jump = command
            .windows(2)
            .position(|args| args == ["-J", "jump@203.0.113.8:2222"])
            .unwrap();
        let tunnel = command
            .windows(2)
            .position(|args| args == ["-L", "127.0.0.1:8080:127.0.0.1:80"])
            .unwrap();
        let destination = command
            .iter()
            .position(|arg| arg == "dev@10.0.0.8")
            .unwrap();
        assert!(jump < tunnel && tunnel < destination);
    }
}
