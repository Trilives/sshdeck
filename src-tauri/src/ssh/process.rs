use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager};

use crate::model::{CriticalErrorPayload, Forward, Host};
use crate::ssh::command::build_ssh_command;
use crate::ssh::diagnose::classify_ssh_failure;
use crate::ssh::readiness::wait_for_tunnel_ready;
use crate::state::{AppState, ManagedTunnel};
use crate::util::{lock_error, no_window};

/// Start a forward's ssh child process and register it in the runtime state.
pub fn start_tunnel(
    host: Host,
    mut forward: Forward,
    state: &AppState,
    app: AppHandle,
    password: Option<String>,
) -> Result<(), String> {
    // If the local port is in use, automatically fall forward to the first free port (only local/dynamic listen locally).
    // Done before locking tunnels; detect_conflict / find_free_port each take their own lock internally.
    if forward.binds_local_port() && !forward.bind_port.trim().is_empty() {
        let original = forward.bind_port.trim().to_string();
        match crate::portcheck::find_free_port(state, &original, &forward.id) {
            Some(port) if port != original => {
                forward.bind_port = port.clone();
                let message = if state.is_zh() {
                    format!("[{}/{}] 本机端口 {} 被占用，已自动改用空闲端口 {}", host.name, forward.name, original, port)
                } else {
                    format!("[{}/{}] local port {} in use, auto-switched to free port {}", host.name, forward.name, original, port)
                };
                state.add_log("info", message, Some(&app));
            }
            Some(_) => {}
            None => {
                // Every port from this one up to the limit is occupied: error out with the conflict details.
                if let Some(conflict) = crate::portcheck::detect_conflict(state, &original, &forward.id) {
                    return Err(conflict.message(state.is_zh(), &original));
                }
            }
        }
    }

    let mut tunnels = state.tunnels.lock().map_err(lock_error)?;
    if let Some(existing) = tunnels.get_mut(&forward.id) {
        if let Some(child) = existing.child.as_mut() {
            if child.try_wait().map_err(|err| err.to_string())?.is_none() {
                return Ok(());
            }
        }
    }

    let command = build_ssh_command(&host, &forward)?;
    state.add_log(
        "debug",
        format!("[{}/{}] $ {}", host.name, forward.name, command.join(" ")),
        Some(&app),
    );
    let mut process = Command::new(&command[0]);
    process
        .args(&command[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    no_window(&mut process);
    if let Some(password_value) = password.as_ref() {
        let helper = prepare_askpass_helper(&state.data_dir)?;
        process
            .env("SSH_ASKPASS", helper)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", "sshdeck")
            .env("SSHDECK_PASSWORD", password_value);
    }
    let mut child = process.spawn().map_err(|err| err.to_string())?;
    if let Err(err) = wait_for_tunnel_ready(&mut child, &forward) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(err);
    }

    let forward_id = forward.id.clone();
    let generation = state.next_tunnel_generation();
    tunnels.insert(
        forward_id.clone(),
        ManagedTunnel {
            host: host.clone(),
            forward: forward.clone(),
            child: Some(child),
            stop_requested: false,
            password,
            generation,
        },
    );
    drop(tunnels);
    state.add_log("info", format!("[{}/{}] connected", host.name, forward.name), Some(&app));
    watch_tunnel(forward_id, generation, state.data_dir.clone(), app);
    Ok(())
}

/// Remove a tunnel entry only if it still carries the given generation — never clobber a newer (reconnected) entry.
fn remove_if_generation(state: &AppState, forward_id: &str, generation: u64) {
    if let Ok(mut tunnels) = state.tunnels.lock() {
        if tunnels.get(forward_id).map(|t| t.generation) == Some(generation) {
            tunnels.remove(forward_id);
        }
    }
}

/// Restart a running forward with new host/forward parameters: reuses its cached password (if any), stop then start.
pub fn restart_forward(
    host: Host,
    forward: Forward,
    state: &AppState,
    app: &AppHandle,
) -> Result<(), String> {
    let password = {
        let tunnels = state.tunnels.lock().map_err(lock_error)?;
        tunnels.get(&forward.id).and_then(|tunnel| tunnel.password.clone())
    };
    stop_tunnel(&forward.id, state, Some(app))?;
    start_tunnel(host, forward, state, app.clone(), password)
}

pub fn stop_tunnel(forward_id: &str, state: &AppState, app: Option<&AppHandle>) -> Result<(), String> {
    let mut tunnels = state.tunnels.lock().map_err(lock_error)?;
    if let Some(tunnel) = tunnels.get_mut(forward_id) {
        tunnel.stop_requested = true;
        if let Some(child) = tunnel.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        state.add_log(
            "info",
            format!("[{}/{}] disconnected", tunnel.host.name, tunnel.forward.name),
            app,
        );
        tunnels.remove(forward_id);
    }
    Ok(())
}

pub fn cleanup_tunnels(state: &AppState, app: Option<&AppHandle>) {
    let tunnels = {
        let Ok(mut tunnels) = state.tunnels.lock() else {
            return;
        };
        tunnels.drain().map(|(_, tunnel)| tunnel).collect::<Vec<_>>()
    };

    for mut tunnel in tunnels {
        tunnel.stop_requested = true;
        if let Some(child) = tunnel.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        state.add_log(
            "info",
            format!("[{}/{}] cleaned up on exit", tunnel.host.name, tunnel.forward.name),
            app,
        );
    }
}

fn watch_tunnel(forward_id: String, generation: u64, data_dir: PathBuf, app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let state = app.state::<AppState>();
        let exit_info = {
            let mut tunnels = match state.tunnels.lock() {
                Ok(tunnels) => tunnels,
                Err(_) => return,
            };
            let Some(tunnel) = tunnels.get_mut(&forward_id) else {
                return;
            };
            // A newer start replaced this entry; that start owns its own watcher — this one should exit.
            if tunnel.generation != generation {
                return;
            }
            let Some(child) = tunnel.child.as_mut() else {
                return;
            };
            match child.try_wait() {
                Ok(None) => continue,
                Ok(Some(status)) => {
                    let host = tunnel.host.clone();
                    let forward = tunnel.forward.clone();
                    let stopped_by_user = tunnel.stop_requested;
                    let mut stderr = String::new();
                    if let Some(mut stderr_pipe) = child.stderr.take() {
                        let _ = stderr_pipe.read_to_string(&mut stderr);
                    }
                    tunnel.child = None;
                    let password = tunnel.password.clone();
                    (host, forward, password, stopped_by_user, status.code(), stderr)
                }
                Err(_) => return,
            }
        };

        let (host, forward, password, stopped_by_user, code, stderr) = exit_info;
        let detail = stderr.trim();
        let label = format!("{}/{}", host.name, forward.name);
        let message = if detail.is_empty() {
            format!("[{}] exited with code {:?}", label, code)
        } else {
            format!("[{}] exited with code {:?}: {}", label, code, detail)
        };
        // Only auth / host-key failures are fatal (the user must fix something). Network-layer 255 exits
        // (timeout, unreachable, refused) and ordinary mid-session drops are transient and should reconnect.
        let kind = classify_ssh_failure(&stderr);
        if code == Some(255) && kind.is_fatal() {
            let critical_message = format!("{}\n\n{}", kind.reason(state.is_zh()), message);
            state.add_log("error", critical_message.clone(), Some(&app));
            let _ = app.emit(
                "critical-error",
                CriticalErrorPayload {
                    host_id: host.id.clone(),
                    forward_id: forward.id.clone(),
                    name: label,
                    message: critical_message,
                },
            );
            remove_if_generation(&state, &forward.id, generation);
            return;
        }

        state.add_log("warning", message, Some(&app));
        if stopped_by_user || !forward.keep_connected {
            remove_if_generation(&state, &forward.id, generation);
            return;
        }

        thread::sleep(Duration::from_secs(3));

        // Re-check after the delay: only reconnect if this exact entry (same generation) still exists and
        // wasn't stopped meanwhile. This closes the window where a disconnect/delete during the sleep would
        // otherwise be undone by a stale watcher resurrecting the tunnel.
        {
            let Ok(tunnels) = state.tunnels.lock() else {
                return;
            };
            match tunnels.get(&forward.id) {
                Some(tunnel) if tunnel.generation == generation && !tunnel.stop_requested => {}
                _ => return,
            }
        }

        let _ = fs::create_dir_all(&data_dir);
        let _ = start_tunnel(host, forward, state.inner(), app.clone(), password);
        return;
    });
}

pub fn prepare_askpass_helper(data_dir: &Path) -> Result<PathBuf, String> {
    let helper_dir = data_dir.join("helpers");
    fs::create_dir_all(&helper_dir).map_err(|err| err.to_string())?;
    // Keep "askpass" in the stem (main.rs detects the mode by filename).
    let helper = helper_dir.join("sshdeck-askpass.exe");
    let current_exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let should_copy = match (fs::metadata(&current_exe), fs::metadata(&helper)) {
        (Ok(current), Ok(existing)) => current.len() != existing.len(),
        (Ok(_), Err(_)) => true,
        _ => true,
    };
    if should_copy {
        fs::copy(&current_exe, &helper).map_err(|err| err.to_string())?;
    }
    Ok(helper)
}

/// Password-injection helper used when uploading a public key: sets the askpass environment on an existing process.
pub fn apply_askpass(process: &mut Command, helper: PathBuf, password: &str) {
    process
        .env("SSH_ASKPASS", helper)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", "sshdeck")
        .env("SSHDECK_PASSWORD", password);
}
