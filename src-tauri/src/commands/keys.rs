use tauri::{AppHandle, Manager, State};

use crate::model::HostView;
use crate::ssh::host_keys::{self, HostFingerprint};
use crate::ssh::keys::{ensure_public_key, upload_if_needed, upload_key_to_remote};
use crate::ssh::probe::probe_connection as probe;
use crate::state::AppState;
use crate::validate::validate_host_connection;

#[tauri::command]
pub async fn upload_public_key(
    host_id: String,
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<HostView, String> {
    let host = state.find_host(&host_id)?;
    validate_host_connection(&host)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        // Recheck at the mutation boundary, including callers outside the host
        // page. Existing agent/key access must not generate or upload a new key.
        let status = probe(&host, state.inner(), &app)?;
        let uploaded = upload_if_needed(&status, &password, || {
            let public_key = ensure_public_key(&host, &app)?;
            upload_key_to_remote(&host, &public_key, &password, state.inner(), &app)
        })?;
        state.add_log(
            "info",
            format!(
                "[{}] {}",
                host.name,
                if uploaded {
                    "public key uploaded"
                } else {
                    "passwordless access already works; key upload skipped"
                }
            ),
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
) -> Result<Option<HostFingerprint>, String> {
    let host = state.find_host(&host_id)?;
    validate_host_connection(&host)?;
    tauri::async_runtime::spawn_blocking(move || host_keys::fingerprint(&host))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn trust_host_fingerprint(
    host_id: String,
    confirmed: HostFingerprint,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let host = state.find_host(&host_id)?;
    validate_host_connection(&host)?;
    tauri::async_runtime::spawn_blocking(move || host_keys::trust(&host, &confirmed))
        .await
        .map_err(|e| e.to_string())?
}
