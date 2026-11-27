use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::model::{Forward, Host, HostView, TunnelStatus};
use crate::ssh::process::{restart_forward, start_tunnel, stop_tunnel};
use crate::state::AppState;
use crate::store::write_json;
use crate::util::{lock_error, now_millis};
use crate::validate::validate_forward;

/// Record a just-opened port in the local history (with a browser URL for local/dynamic forwards so it can be
/// reopened), then rescan VS Code's history — opening a port is one of the moments we refresh it.
fn record_port_open(state: &AppState, host: &Host, forward: &Forward, app: &AppHandle) {
    let view = state.forward_view(forward.clone());
    let port = view.forward.bind_port.trim().to_string();
    let detail = if forward.binds_local_port() && !port.is_empty() {
        let bind = forward.bind_host.trim();
        let display_host = if bind.is_empty() || bind == "0.0.0.0" { "127.0.0.1" } else { bind };
        format!("http://{display_host}:{port}")
    } else {
        String::new()
    };
    let label = view.forward.history_label();
    state.record_open(&host.id, "port", &label, "", &detail);
    if let Err(error) = save_forward_activity(state, &host.id, &forward.id) {
        state.add_log("warning", format!("Could not save forward activity: {error}"), Some(app));
    }
    state.merge_vscode_history(&host.id, &host.ssh_host);
}

fn save_forward_activity(state: &AppState, host_id: &str, forward_id: &str) -> Result<(), String> {
    let mut hosts = state.hosts.lock().map_err(lock_error)?;
    let Some(host) = hosts.iter_mut().find(|host| host.id == host_id) else {
        return Ok(());
    };
    let Some(index) = host.forwards.iter().position(|forward| forward.id == forward_id) else {
        return Ok(());
    };
    // Preserve the last action's place even if two events share a timestamp.
    host.forwards[..=index].rotate_right(1);
    host.forwards[0].last_activity_at = Some(now_millis());
    write_json(state.hosts_path(), &*hosts)
}

#[tauri::command]
pub fn save_forward(
    host_id: String,
    mut forward: Forward,
    state: State<AppState>,
    app: AppHandle,
) -> Result<HostView, String> {
    // No parameter validation or port-in-use check when creating/editing a forward; both are deferred to connect time.
    if forward.id.trim().is_empty() {
        forward.id = Uuid::new_v4().to_string();
    }

    // Record the old tunnel-relevant parameters, to determine whether a running forward needs to reconnect.
    let mut tunnel_changed = false;
    let mut hosts = state.hosts.lock().map_err(lock_error)?;
    let host = hosts
        .iter_mut()
        .find(|item| item.id == host_id)
        .ok_or_else(|| "Host not found.".to_string())?;
    if let Some(existing) = host.forwards.iter_mut().find(|item| item.id == forward.id) {
        tunnel_changed = existing.mode != forward.mode
            || existing.bind_host.trim() != forward.bind_host.trim()
            || existing.bind_port.trim() != forward.bind_port.trim()
            || existing.target_host.trim() != forward.target_host.trim()
            || existing.target_port.trim() != forward.target_port.trim()
            // keepConnected is captured in the running tunnel's snapshot, so restart to pick up the new value.
            || existing.keep_connected != forward.keep_connected;
        forward.last_activity_at = existing.last_activity_at;
        *existing = forward.clone();
    } else {
        forward.last_activity_at = Some(now_millis());
        host.forwards.insert(0, forward.clone());
    }
    let host_name = host.name.clone();
    write_json(state.hosts_path(), &*hosts)?;
    drop(hosts);
    state.add_log("info", format!("[{}/{}] forward saved", host_name, forward.name), Some(&app));

    // This forward's ip/port/mode changed while running → disconnect and reconnect it with the new parameters.
    if tunnel_changed && matches!(state.status_for(&forward.id), TunnelStatus::Running) {
        let host = state.find_host(&host_id)?;
        if let Err(err) = restart_forward(host, forward.clone(), state.inner(), &app) {
            state.add_log(
                "warning",
                format!("[{}/{}] reconnect after edit failed: {}", host_name, forward.name, err),
                Some(&app),
            );
        }
    }
    Ok(state.host_view(state.find_host(&host_id)?))
}

#[tauri::command]
pub fn delete_forward(
    host_id: String,
    forward_id: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<HostView, String> {
    if matches!(state.status_for(&forward_id), TunnelStatus::Running) {
        return Err("Disconnect this forward before deleting it.".to_string());
    }
    let mut hosts = state.hosts.lock().map_err(lock_error)?;
    let host = hosts
        .iter_mut()
        .find(|item| item.id == host_id)
        .ok_or_else(|| "Host not found.".to_string())?;
    let name = host
        .forwards
        .iter()
        .find(|item| item.id == forward_id)
        .map(|item| item.name.clone())
        .unwrap_or_else(|| forward_id.clone());
    host.forwards.retain(|item| item.id != forward_id);
    let host_name = host.name.clone();
    write_json(state.hosts_path(), &*hosts)?;
    drop(hosts);
    state.add_log("info", format!("[{}/{}] forward deleted", host_name, name), Some(&app));
    Ok(state.host_view(state.find_host(&host_id)?))
}

#[tauri::command]
pub fn connect_forward(
    host_id: String,
    forward_id: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<HostView, String> {
    let (host, forward) = state.find_forward(&host_id, &forward_id)?;
    if matches!(state.status_for(&forward_id), TunnelStatus::Running) {
        return Ok(state.host_view(host));
    }
    validate_forward(&forward)?;
    start_tunnel(host.clone(), forward.clone(), state.inner(), app.clone(), None)?;
    record_port_open(state.inner(), &host, &forward, &app);
    Ok(state.host_view(state.find_host(&host_id)?))
}

#[tauri::command]
pub fn connect_forward_with_password(
    host_id: String,
    forward_id: String,
    password: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<HostView, String> {
    if password.is_empty() {
        return Err("Password is required.".to_string());
    }
    let (host, forward) = state.find_forward(&host_id, &forward_id)?;
    if matches!(state.status_for(&forward_id), TunnelStatus::Running) {
        return Ok(state.host_view(host));
    }
    validate_forward(&forward)?;
    start_tunnel(host.clone(), forward.clone(), state.inner(), app.clone(), Some(password))?;
    record_port_open(state.inner(), &host, &forward, &app);
    Ok(state.host_view(state.find_host(&host_id)?))
}

#[tauri::command]
pub fn disconnect_forward(
    host_id: String,
    forward_id: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<HostView, String> {
    stop_tunnel(&forward_id, state.inner(), Some(&app))?;
    Ok(state.host_view(state.find_host(&host_id)?))
}

#[tauri::command]
pub fn disconnect_host(
    host_id: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<HostView, String> {
    let host = state.find_host(&host_id)?;
    for forward in &host.forwards {
        if matches!(state.status_for(&forward.id), TunnelStatus::Running) {
            stop_tunnel(&forward.id, state.inner(), Some(&app))?;
        }
    }
    Ok(state.host_view(state.find_host(&host_id)?))
}

#[tauri::command]
pub fn disconnect_all(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let ids: Vec<String> = state.tunnels.lock().map_err(lock_error)?.keys().cloned().collect();
    for id in ids {
        stop_tunnel(&id, state.inner(), Some(&app))?;
    }
    Ok(())
}
