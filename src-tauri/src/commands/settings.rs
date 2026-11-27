use tauri::{AppHandle, State};

use crate::model::{AppSettings, LogEntry};
use crate::state::AppState;
use crate::store::write_json;
use crate::util::{lock_error, log_rank, normalize_choice};

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    state.settings.lock().map_err(lock_error).map(|settings| settings.clone())
}

#[tauri::command]
pub fn save_settings_cmd(
    settings: AppSettings,
    state: State<AppState>,
    app: AppHandle,
) -> Result<AppSettings, String> {
    let normalized = AppSettings {
        theme: normalize_choice(&settings.theme, &["dark", "light", "system"], "light"),
        accent_color: normalize_choice(
            &settings.accent_color,
            &["blue", "violet", "teal", "orange", "monochrome"],
            "blue",
        ),
        language: normalize_choice(&settings.language, &["zh-CN", "en-US"], "zh-CN"),
        log_level: normalize_choice(&settings.log_level, &["debug", "info", "warning", "error"], "info"),
        close_behavior: normalize_choice(&settings.close_behavior, &["ask", "minimize", "exit"], "ask"),
        auto_sort_hosts: settings.auto_sort_hosts,
        two_column_hosts: settings.two_column_hosts,
        auto_update: settings.auto_update,
        update_channel: normalize_choice(&settings.update_channel, &["stable", "preview"], "stable"),
    };
    let mut settings = state.settings.lock().map_err(lock_error)?;
    let appearance_changed = settings.theme != normalized.theme
        || settings.accent_color != normalized.accent_color;
    write_json(state.settings_path(), &normalized)?;
    *settings = normalized.clone();
    drop(settings);
    if appearance_changed {
        crate::window_appearance::apply(&app, &normalized);
    }
    state.add_log(
        "info",
        format!(
            "[settings] theme={} language={} logLevel={} closeBehavior={} autoUpdate={} updateChannel={}",
            normalized.theme, normalized.language, normalized.log_level, normalized.close_behavior, normalized.auto_update, normalized.update_channel
        ),
        Some(&app),
    );
    Ok(normalized)
}

#[tauri::command]
pub fn list_logs(level: String, state: State<AppState>) -> Result<Vec<LogEntry>, String> {
    let min_rank = log_rank(&level);
    let logs = state.logs.lock().map_err(lock_error)?;
    Ok(logs
        .iter()
        .filter(|entry| log_rank(&entry.level) >= min_rank)
        .cloned()
        .collect())
}
