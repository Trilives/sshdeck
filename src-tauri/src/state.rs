use chrono::Local;
use std::{
    cmp::Reverse,
    collections::HashMap,
    fs,
    path::PathBuf,
    process::Child,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::model::{
    AppSettings, Forward, ForwardView, HistoryEntry, Host, HostView, LogEntry, TunnelStatus,
};
use crate::store::{read_json, write_json};
use crate::util::{lock_error, now_millis};

/// A running forward: keeps a snapshot of the parent host and forward, used for auto-reconnect after disconnect.
pub struct ManagedTunnel {
    pub host: Host,
    pub forward: Forward,
    pub child: Option<Child>,
    pub stop_requested: bool,
    pub password: Option<String>,
    /// Unique per (re)start. A reconnect watcher only resurrects an entry whose generation still matches its own,
    /// so a tunnel that was disconnected/deleted (and possibly reconnected) in the meantime can't be revived.
    pub generation: u64,
}

impl Drop for ManagedTunnel {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub struct AppState {
    pub hosts: Mutex<Vec<Host>>,
    pub settings: Mutex<AppSettings>,
    /// key = forward id
    pub tunnels: Mutex<HashMap<String, ManagedTunnel>>,
    pub logs: Mutex<Vec<LogEntry>>,
    /// Local open-history (ports/VS Code/terminal), persisted to history.json.
    pub history: Mutex<Vec<HistoryEntry>>,
    pub transfer_folders: Mutex<HashMap<String, Vec<String>>>,
    pub data_dir: PathBuf,
    /// Monotonic source of `ManagedTunnel::generation` values.
    tunnel_generation: AtomicU64,
}

impl AppState {
    pub fn new() -> Self {
        let data_dir = crate::app_data::resolve();
        let _ = fs::create_dir_all(&data_dir);

        // The v0.1.x flat profiles.json is no longer used: back it up once if present, to avoid misreading the old structure.
        let legacy = data_dir.join("profiles.json");
        if legacy.exists() {
            let backup = data_dir.join("profiles.json.v0.1.bak");
            if !backup.exists() {
                let _ = fs::rename(&legacy, &backup);
            }
        }

        let mut hosts: Vec<Host> = read_json(data_dir.join("hosts.json")).unwrap_or_default();
        let history: Vec<HistoryEntry> = read_json(data_dir.join("history.json")).unwrap_or_default();
        crate::host_order::initialize(&mut hosts);
        restore_forward_activity(&mut hosts, &history);

        Self {
            hosts: Mutex::new(hosts),
            settings: Mutex::new(read_json(data_dir.join("settings.json")).unwrap_or_default()),
            tunnels: Mutex::new(HashMap::new()),
            logs: Mutex::new(Vec::new()),
            history: Mutex::new(history),
            transfer_folders: Mutex::new(
                read_json(data_dir.join("transfer-folders.json")).unwrap_or_default(),
            ),
            data_dir,
            tunnel_generation: AtomicU64::new(1),
        }
    }

    /// Allocate a fresh, unique tunnel generation.
    pub fn next_tunnel_generation(&self) -> u64 {
        self.tunnel_generation.fetch_add(1, Ordering::Relaxed)
    }

    pub fn hosts_path(&self) -> PathBuf {
        self.data_dir.join("hosts.json")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.data_dir.join("logs")
    }

    pub fn history_path(&self) -> PathBuf {
        self.data_dir.join("history.json")
    }

    pub fn record_transfer_folders(&self, endpoints: [(&str, &str); 2]) {
        if let Ok(mut folders) = self.transfer_folders.lock() {
            for (host_id, path) in endpoints {
                if path.is_empty() {
                    continue;
                }
                let paths = folders.entry(host_id.to_string()).or_default();
                paths.retain(|existing| existing != path);
                paths.insert(0, path.to_string());
                paths.truncate(30);
            }
            let _ = write_json(self.data_dir.join("transfer-folders.json"), &*folders);
        }
    }

    /// Upsert one open-history entry (dedup/bump handled by `history::upsert`) and persist.
    pub fn record_open(&self, host_id: &str, kind: &str, label: &str, uri: &str, detail: &str) {
        if let Ok(mut history) = self.history.lock() {
            crate::history::upsert(
                &mut history,
                HistoryEntry {
                    id: Uuid::new_v4().to_string(),
                    host_id: host_id.to_string(),
                    kind: kind.to_string(),
                    label: label.to_string(),
                    uri: uri.to_string(),
                    detail: detail.to_string(),
                    opened_at: now_millis(),
                },
            );
            let _ = write_json(self.history_path(), &*history);
        }
    }

    /// Scan VS Code's own Remote-SSH history for this host's IP and merge any entries we don't already track.
    pub fn merge_vscode_history(&self, host_id: &str, ip: &str) {
        let scanned: Vec<(String, String)> = crate::vscode::ssh_history_for_ip(ip)
            .into_iter()
            .map(|entry| (entry.uri, entry.path))
            .collect();
        if scanned.is_empty() {
            return;
        }
        if let Ok(mut history) = self.history.lock() {
            crate::history::merge_scanned(&mut history, host_id, &scanned, now_millis(), || {
                Uuid::new_v4().to_string()
            });
            let _ = write_json(self.history_path(), &*history);
        }
    }

    /// This host's open-history, most recent first.
    pub fn history_for_host(&self, host_id: &str) -> Vec<HistoryEntry> {
        self.history
            .lock()
            .map(|history| crate::history::sorted_for_host(&history, host_id))
            .unwrap_or_default()
    }

    pub fn add_log(&self, level: &str, message: impl Into<String>, app: Option<&AppHandle>) {
        let entry = LogEntry {
            level: level.to_string(),
            message: message.into(),
            timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };
        let _ = fs::create_dir_all(self.logs_dir());
        let file_path = self
            .logs_dir()
            .join(format!("{}.log", Local::now().format("%Y-%m-%d")));
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(file_path)
            .and_then(|mut file| {
                use std::io::Write;
                writeln!(
                    file,
                    "{} [{}] {}",
                    entry.timestamp,
                    entry.level.to_uppercase(),
                    entry.message
                )
            });

        if let Ok(mut logs) = self.logs.lock() {
            logs.push(entry.clone());
            if logs.len() > 500 {
                let drain_count = logs.len() - 500;
                logs.drain(0..drain_count);
            }
        }
        if let Some(app) = app {
            let _ = app.emit("log-entry", entry);
        }
    }

    /// Whether the current UI language is Simplified Chinese (used to localize backend error messages); defaults to Chinese if the lock fails.
    pub fn is_zh(&self) -> bool {
        self.settings
            .lock()
            .map(|settings| settings.language == "zh-CN")
            .unwrap_or(true)
    }

    /// The configured close-button behavior: `ask` | `minimize` | `exit`.
    pub fn close_behavior(&self) -> String {
        self.settings
            .lock()
            .map(|settings| settings.close_behavior.clone())
            .unwrap_or_else(|_| "ask".to_string())
    }

    /// Number of forwards whose child process is still running.
    pub fn active_tunnel_count(&self) -> usize {
        let Ok(mut tunnels) = self.tunnels.lock() else {
            return 0;
        };
        let mut count = 0;
        for tunnel in tunnels.values_mut() {
            if let Some(child) = tunnel.child.as_mut() {
                if child.try_wait().ok().flatten().is_none() {
                    count += 1;
                }
            }
        }
        count
    }

    pub fn status_for(&self, forward_id: &str) -> TunnelStatus {
        let mut tunnels = self.tunnels.lock().unwrap();
        if let Some(tunnel) = tunnels.get_mut(forward_id) {
            if let Some(child) = tunnel.child.as_mut() {
                if child.try_wait().ok().flatten().is_none() {
                    return TunnelStatus::Running;
                }
            }
        }
        TunnelStatus::Stopped
    }

    pub fn forward_view(&self, mut forward: Forward) -> ForwardView {
        let status = self.status_for(&forward.id);
        // While running: override the displayed value with the actual listening port (may differ from the configured
        // port after auto-fallback), so Home, the forward row, and "Open in browser" all point at the port really being listened on.
        if status == TunnelStatus::Running {
            if let Ok(tunnels) = self.tunnels.lock() {
                if let Some(tunnel) = tunnels.get(&forward.id) {
                    forward.bind_port = tunnel.forward.bind_port.clone();
                }
            }
        }
        ForwardView {
            status,
            bind_display: forward.bind_display(),
            target_display: forward.target_display(),
            forward,
        }
    }

    pub fn host_view(&self, mut host: Host) -> HostView {
        host.forwards.sort_by_key(|forward| Reverse(forward.last_activity_at));
        let forwards = host
            .forwards
            .into_iter()
            .map(|forward| self.forward_view(forward))
            .collect();
        HostView {
            id: host.id,
            name: host.name,
            ssh_host: host.ssh_host,
            ssh_port: host.ssh_port,
            ssh_user: host.ssh_user,
            identity_file: host.identity_file,
            extra_options: host.extra_options,
            proxy_jump: host.proxy_jump,
            forwards,
            pinned: host.pinned,
            updated_at: host.updated_at,
        }
    }

    pub fn find_host(&self, host_id: &str) -> Result<Host, String> {
        self.hosts
            .lock()
            .map_err(lock_error)?
            .iter()
            .find(|item| item.id == host_id)
            .cloned()
            .ok_or_else(|| "Host not found.".to_string())
    }

    /// Get a clone of the host together with one of its forwards (connect/operate needs the parent host's connection parameters).
    pub fn find_forward(&self, host_id: &str, forward_id: &str) -> Result<(Host, Forward), String> {
        let host = self.find_host(host_id)?;
        let forward = host
            .forwards
            .iter()
            .find(|item| item.id == forward_id)
            .cloned()
            .ok_or_else(|| "Forward not found.".to_string())?;
        Ok((host, forward))
    }
}

fn restore_forward_activity(hosts: &mut [Host], history: &[HistoryEntry]) {
    for host in hosts {
        for forward in &mut host.forwards {
            if forward.last_activity_at.is_some() {
                continue;
            }
            let label = forward.history_label();
            forward.last_activity_at = history
                .iter()
                .filter(|entry| entry.kind == "port" && entry.host_id == host.id && entry.label == label)
                .map(|entry| entry.opened_at)
                .max();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_port_history_restores_activity_without_overwriting_saved_activity() {
        let mut host = Host {
            forwards: vec![
                Forward { name: "legacy".into(), ..Forward::default() },
                Forward { name: "created".into(), last_activity_at: Some(30), ..Forward::default() },
                Forward { name: "unused".into(), ..Forward::default() },
            ],
            ..Host::default()
        };
        let entry = |index: usize, opened_at| HistoryEntry {
            id: String::new(),
            host_id: host.id.clone(),
            kind: "port".into(),
            label: host.forwards[index].history_label(),
            uri: String::new(),
            detail: String::new(),
            opened_at,
        };
        let history = [entry(0, 10), entry(0, 20), entry(1, 25)];
        restore_forward_activity(std::slice::from_mut(&mut host), &history);

        assert_eq!(host.forwards[0].last_activity_at, Some(20));
        assert_eq!(host.forwards[1].last_activity_at, Some(30));
        assert_eq!(host.forwards[2].last_activity_at, None);
    }
}
