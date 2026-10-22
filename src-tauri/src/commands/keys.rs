use tauri::{AppHandle, Manager, State};

use crate::model::HostView;
use crate::ssh::keys::{ensure_public_key, upload_key_to_remote};
use crate::ssh::probe::{
    get_host_fingerprint as fingerprint, probe_connection as probe,
    remove_known_host as remove_host,
};
use crate::state::AppState;
use crate::validate::validate_host_connection;

#[tauri::command]
pub async fn upload_public_key(
    host_id: String,
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<HostView, String> {
    if password.is_empty() {
        return Err("Password is required.".to_string());
    }
    let host = state.find_host(&host_id)?;
    validate_host_connection(&host)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let public_key = ensure_public_key(&host, &app)?;
        upload_key_to_remote(&host, &public_key, &password, state.inner(), &app)?;
        state.add_log(
            "info",
            format!("[{}] public key uploaded", host.name),
            Some(&app),
        );
        Ok(state.host_view(host))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn probe_connection(
    host_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let host = state.find_host(&host_id)?;
    validate_host_connection(&host)?;
    tauri::async_runtime::spawn_blocking(move || {
        probe(&host, app.state::<AppState>().inner(), &app)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_host_fingerprint(
    host_id: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<String, String> {
    let host = state.find_host(&host_id)?;
    validate_host_connection(&host)?;
    tauri::async_runtime::spawn_blocking(move || fingerprint(&host))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_known_host(
    host_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let host = state.find_host(&host_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        remove_host(&host, app.state::<AppState>().inner(), &app)
    })
    .await
    .map_err(|e| e.to_string())?
}
