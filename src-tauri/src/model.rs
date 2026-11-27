use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::util::empty_default;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelMode {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus {
    Running,
    Stopped,
}

/// Level 2: a single port forward nested under a host, storing only the forwarding parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Forward {
    pub id: String,
    pub name: String,
    pub mode: TunnelMode,
    pub bind_host: String,
    pub bind_port: String,
    pub target_host: String,
    pub target_port: String,
    pub keep_connected: bool,
}

impl Default for Forward {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: "new forward".to_string(),
            mode: TunnelMode::Local,
            bind_host: "127.0.0.1".to_string(),
            bind_port: String::new(),
            target_host: "127.0.0.1".to_string(),
            target_port: String::new(),
            keep_connected: true,
        }
    }
}

impl Forward {
    pub fn bind_display(&self) -> String {
        format!("{}:{}", empty_default(&self.bind_host, "127.0.0.1"), self.bind_port.trim())
    }

    pub fn target_display(&self) -> String {
        if self.mode == TunnelMode::Dynamic {
            "SOCKS proxy".to_string()
        } else {
            format!("{}:{}", empty_default(&self.target_host, "127.0.0.1"), self.target_port.trim())
        }
    }

    /// Only local / dynamic listen on a local port; remote listens on the remote side.
    pub fn binds_local_port(&self) -> bool {
        matches!(self.mode, TunnelMode::Local | TunnelMode::Dynamic)
    }
}

/// Level 1: an SSH server, storing connection parameters and its list of forwards.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub name: String,
    pub ssh_host: String,
    pub ssh_port: String,
    pub ssh_user: String,
    pub identity_file: String,
    pub extra_options: String,
    /// Jump host (ProxyJump); optional. Shaped like `user@jump-host:port`; use commas for multiple hops.
    #[serde(default)]
    pub proxy_jump: String,
    #[serde(default)]
    pub forwards: Vec<Forward>,
    /// Whether pinned; pinned hosts sort to the front of the list.
    #[serde(default)]
    pub pinned: bool,
    /// Last-modified time (Unix ms), used when automatic sorting is enabled.
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manual_order: Option<usize>,
}

impl Default for Host {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: "new host".to_string(),
            ssh_host: String::new(),
            ssh_port: "22".to_string(),
            ssh_user: String::new(),
            identity_file: String::new(),
            extra_options: String::new(),
            proxy_jump: String::new(),
            forwards: Vec::new(),
            pinned: false,
            updated_at: 0,
            manual_order: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardView {
    #[serde(flatten)]
    pub forward: Forward,
    pub status: TunnelStatus,
    pub bind_display: String,
    pub target_display: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostView {
    pub id: String,
    pub name: String,
    pub ssh_host: String,
    pub ssh_port: String,
    pub ssh_user: String,
    pub identity_file: String,
    pub extra_options: String,
    pub proxy_jump: String,
    pub forwards: Vec<ForwardView>,
    pub pinned: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    pub language: String,
    pub log_level: String,
    /// What clicking the window's close button does: `ask` (prompt each time), `minimize` (to the tray),
    /// or `exit` (quit the app). When forwards are running, `exit` still prompts as a safety check.
    #[serde(default = "default_close_behavior")]
    pub close_behavior: String,
    #[serde(default)]
    pub auto_sort_hosts: bool,
    /// When true, a newer signed release found on startup is downloaded and installed automatically;
    /// when false, the app only surfaces an "update available" notice and lets the user install it.
    #[serde(default)]
    pub auto_update: bool,
    /// Which release channel to check for updates: `stable` (default) or `preview` (pre-releases).
    #[serde(default = "default_update_channel")]
    pub update_channel: String,
}

fn default_accent_color() -> String {
    "blue".to_string()
}

fn default_close_behavior() -> String {
    "ask".to_string()
}

fn default_update_channel() -> String {
    "stable".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            accent_color: default_accent_color(),
            language: "zh-CN".to_string(),
            log_level: "info".to_string(),
            close_behavior: default_close_behavior(),
            auto_sort_hosts: false,
            auto_update: false,
            update_channel: default_update_channel(),
        }
    }
}

#[cfg(test)]
mod settings_tests {
    use super::AppSettings;

    #[test]
    fn settings_saved_before_accent_colors_keep_the_display_mode() {
        let settings: AppSettings = serde_json::from_value(serde_json::json!({
            "theme": "dark",
            "language": "en-US",
            "logLevel": "warning",
            "updateChannel": "preview"
        }))
        .unwrap();

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.language, "en-US");
        assert_eq!(settings.update_channel, "preview");
        assert_eq!(settings.accent_color, "blue");
    }
}

/// One entry in the local "open history": a port that was opened, a VS Code remote folder that was launched,
/// or a terminal that was opened. Persisted to `history.json` and sorted by `opened_at` (most recent first).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub host_id: String,
    /// `vscode` | `terminal` | `port`.
    pub kind: String,
    /// Primary display text (VS Code remote path, host name for terminal, or the forward's bind address for a port).
    pub label: String,
    /// VS Code folder URI, used to reopen a `vscode` entry as-is. Empty for other kinds.
    #[serde(default)]
    pub uri: String,
    /// Secondary payload: the browser URL for a `port` entry (so it can be reopened). Empty otherwise.
    #[serde(default)]
    pub detail: String,
    /// When this entry was last opened/discovered (Unix ms).
    pub opened_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticalErrorPayload {
    pub host_id: String,
    pub forward_id: String,
    pub name: String,
    pub message: String,
}
