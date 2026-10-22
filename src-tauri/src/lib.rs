mod app_data;
mod commands;
mod files;
mod history;
mod model;
mod portcheck;
mod ssh;
mod sshconfig;
mod state;
mod store;
mod terminal;
mod util;
mod validate;
mod vscode;
mod vscode_launcher;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

use crate::commands::window::show_main_window;
use crate::ssh::process::cleanup_tunnels;
use crate::state::AppState;

pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second launch focuses the running window instead of starting anew.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        // In-app auto-update: `updater` checks/downloads/installs signed releases; `process` relaunches after install.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .manage(crate::files::FileTransfers::default())
        .manage(crate::ssh::worker::CommandRuns::default())
        .invoke_handler(tauri::generate_handler![
            commands::hosts::list_hosts,
            commands::hosts::save_host,
            commands::hosts::set_host_pinned,
            commands::hosts::delete_host,
            commands::transfer::read_import_file,
            commands::transfer::read_import_ssh_config,
            commands::transfer::import_hosts,
            commands::transfer::export_hosts_to_file,
            commands::transfer::export_hosts_to_ssh_config,
            commands::forwards::save_forward,
            commands::forwards::delete_forward,
            commands::forwards::connect_forward,
            commands::forwards::connect_forward_with_password,
            commands::forwards::disconnect_forward,
            commands::forwards::disconnect_host,
            commands::forwards::disconnect_all,
            commands::exec::send_command,
            commands::exec::cancel_command,
            commands::files::open_file_session,
            commands::files::setup_direct_access,
            commands::files::list_files,
            commands::files::close_file_session,
            commands::files::start_file_transfer,
            commands::files::list_file_transfers,
            commands::files::cancel_file_transfer,
            commands::exec::send_command_with_password,
            commands::exec::open_terminal,
            commands::exec::open_url,
            commands::keys::upload_public_key,
            commands::keys::probe_connection,
            commands::keys::get_host_fingerprint,
            commands::keys::remove_known_host,
            commands::settings::get_settings,
            commands::settings::save_settings_cmd,
            commands::settings::list_logs,
            commands::system::check_ssh,
            commands::system::install_openssh,
            commands::vscode::vscode_status,
            commands::vscode::vscode_open,
            commands::vscode::vscode_open_direct,
            commands::vscode::vscode_open_path,
            commands::history::list_history,
            commands::update::check_update,
            commands::update::install_update,
            commands::window::hide_to_tray,
            commands::window::quit_app
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            let handle = app.handle().clone();
            state.add_log("info", "application started", Some(&handle));
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                handle_close_requested(window, api);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                app_handle
                    .state::<crate::files::FileTransfers>()
                    .cancel_all();
                if let Ok(runs) = app_handle
                    .state::<crate::ssh::worker::CommandRuns>()
                    .active
                    .lock()
                {
                    for cancel in runs.values() {
                        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
                    }
                }
                let state = app_handle.state::<AppState>();
                cleanup_tunnels(state.inner(), Some(app_handle));
                // Give cancelled workers time to close their SSH children before the runtime exits.
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
                while std::time::Instant::now() < deadline {
                    let commands = app_handle
                        .state::<crate::ssh::worker::CommandRuns>()
                        .active
                        .lock()
                        .map(|r| r.len())
                        .unwrap_or(0);
                    if commands == 0
                        && app_handle
                            .state::<crate::files::FileTransfers>()
                            .active_count()
                            == 0
                    {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(40));
                }
                if let Ok(mut sessions) = app_handle
                    .state::<crate::files::FileTransfers>()
                    .sessions
                    .lock()
                {
                    sessions.clear();
                }
            }
        });
}

/// Decide what the window's close button does. `minimize` hides to tray; `exit` quits only when nothing is
/// running; otherwise (`ask`, or `exit` while forwards are live) the close is prevented and the UI is asked to prompt.
fn handle_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    let behavior = state.close_behavior();
    let active = state.active_tunnel_count() > 0
        || app.state::<crate::files::FileTransfers>().active_count() > 0
        || app
            .state::<crate::ssh::worker::CommandRuns>()
            .active
            .lock()
            .map(|runs| !runs.is_empty())
            .unwrap_or(false);

    if behavior == "minimize" {
        api.prevent_close();
        let _ = window.hide();
    } else if behavior == "exit" && !active {
        // Allow the close to proceed → the app exits and running forwards are cleaned up.
    } else {
        api.prevent_close();
        let _ = window.show();
        let _ = window.set_focus();
        // The UI shows the close/minimize dialog; `active` tells it whether forwards are still running.
        let _ = app.emit("close-requested", active);
    }
}

/// Build the system-tray icon and its menu (localized to the current UI language).
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let zh = app.state::<AppState>().is_zh();
    let (show_label, quit_label, tooltip) = if zh {
        ("显示主窗口", "退出", "SSHDeck")
    } else {
        ("Show Window", "Quit", "SSHDeck")
    };

    let show = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip(tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
