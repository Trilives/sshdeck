use std::process::Command;

use tauri::{AppHandle, State};

use crate::ssh::exec::run_command;
use crate::ssh::worker::CommandRuns;
use crate::state::AppState;
use crate::terminal::open_terminal as open_terminal_window;
use crate::util::no_window;
use tauri::Manager;

/// Run a single command on the host over SSH, returning the output (relies on passwordless login being configured).
#[tauri::command]
pub async fn send_command(
    run_id: String,
    host_id: String,
    command: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Command is required.".to_string());
    }
    let host = state.find_host(&host_id)?;
    let command = command.trim().to_string();
    state.add_log(
        "info",
        format!("[{}] exec $ {command}", host.name),
        Some(&app),
    );
    let data_dir = state.data_dir.clone();
    execute(run_id, host, command, None, data_dir, app).await
}

/// Run a single command on the host over SSH, using a one-time password (injected via askpass).
#[tauri::command]
pub async fn send_command_with_password(
    run_id: String,
    host_id: String,
    command: String,
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Command is required.".to_string());
    }
    if password.is_empty() {
        return Err("Password is required.".to_string());
    }
    let host = state.find_host(&host_id)?;
    let command = command.trim().to_string();
    state.add_log(
        "info",
        format!("[{}] exec(pw) $ {command}", host.name),
        Some(&app),
    );
    let data_dir = state.data_dir.clone();
    execute(run_id, host, command, Some(password), data_dir, app).await
}

async fn execute(
    run_id: String,
    host: crate::model::Host,
    command: String,
    password: Option<String>,
    data_dir: std::path::PathBuf,
    app: AppHandle,
) -> Result<String, String> {
    let cancel = app.state::<CommandRuns>().register(&run_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_command(&host, &command, password.as_deref(), &data_dir, &cancel)
    })
    .await;
    if let Ok(mut map) = app.state::<CommandRuns>().active.lock() {
        map.remove(&run_id);
    }
    result.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_command(run_id: String, runs: State<CommandRuns>) -> Result<(), String> {
    runs.cancel(&run_id)
}

/// Open an external PowerShell terminal window connected to the host, optionally `cd`'d into a remote path.
#[tauri::command]
pub fn open_terminal(
    host_id: String,
    path: Option<String>,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let host = state.find_host(&host_id)?;
    let path = path.as_deref().map(str::trim).filter(|p| !p.is_empty());
    open_terminal_window(&host, path)?;
    match path {
        // A path terminal is already represented by the host's VS Code path list, so it isn't recorded again.
        Some(path) => state.add_log(
            "info",
            format!("[{}] opened terminal at {path}", host.name),
            Some(&app),
        ),
        None => {
            state.record_open(&host.id, "terminal", &host.name, "", "");
            state.add_log(
                "info",
                format!("[{}] opened terminal", host.name),
                Some(&app),
            );
        }
    }
    Ok(())
}

/// Open an http/https link with the system default browser (used by the forward's "Open in browser").
#[tauri::command]
pub fn open_url(url: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http/https URLs are allowed.".to_string());
    }
    // rundll32's FileProtocolHandler opens the browser via the system's default association, with no console window.
    let mut command = Command::new("rundll32");
    command.args(["url.dll,FileProtocolHandler", url]);
    no_window(&mut command);
    command.spawn().map_err(|err| err.to_string())?;
    state.add_log("info", format!("open url {url}"), Some(&app));
    Ok(())
}
