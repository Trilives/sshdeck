import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  Forward,
  HistoryEntry,
  Host,
  ImportResult,
  LogEntry,
  UpdateChannel,
  VscodeOpenRootResult,
  VscodeStatus,
} from "./types";

/** Update offered on a channel (from the Rust channel-aware updater). */
export interface UpdateInfo {
  version: string;
  notes: string;
}

export const api = {
  // Hosts (level 1)
  listHosts: () => invoke<Host[]>("list_hosts"),
  saveHost: (host: Host) => invoke<Host>("save_host", { host }),
  setHostPinned: (id: string, pinned: boolean) => invoke<Host>("set_host_pinned", { id, pinned }),
  deleteHost: (id: string) => invoke<void>("delete_host", { id }),

  // Import / export
  readImportFile: () => invoke<Host[]>("read_import_file"),
  readImportSshConfig: () => invoke<Host[]>("read_import_ssh_config"),
  importHosts: (hosts: Host[], strategy: string) => invoke<ImportResult>("import_hosts", { hosts, strategy }),
  exportHostsToFile: (hostIds: string[]) => invoke<boolean>("export_hosts_to_file", { hostIds }),
  exportHostsToSshConfig: (hostIds: string[], strategy: string) =>
    invoke<ImportResult>("export_hosts_to_ssh_config", { hostIds, strategy }),

  // Port forwards (level 2)
  saveForward: (hostId: string, forward: Forward) => invoke<Host>("save_forward", { hostId, forward }),
  deleteForward: (hostId: string, forwardId: string) => invoke<Host>("delete_forward", { hostId, forwardId }),
  connectForward: (hostId: string, forwardId: string) => invoke<Host>("connect_forward", { hostId, forwardId }),
  connectForwardWithPassword: (hostId: string, forwardId: string, password: string) =>
    invoke<Host>("connect_forward_with_password", { hostId, forwardId, password }),
  disconnectForward: (hostId: string, forwardId: string) => invoke<Host>("disconnect_forward", { hostId, forwardId }),
  disconnectHost: (hostId: string) => invoke<Host>("disconnect_host", { hostId }),
  disconnectAll: () => invoke<void>("disconnect_all"),

  // Command / terminal / keys
  sendCommand: (hostId: string, command: string, runId: string) => invoke<string>("send_command", { hostId, command, runId }),
  sendCommandWithPassword: (hostId: string, command: string, password: string, runId: string) =>
    invoke<string>("send_command_with_password", { hostId, command, password, runId }),
  cancelCommand: (runId: string) => invoke<void>("cancel_command", { runId }),
  openTerminal: (hostId: string, path?: string) => invoke<void>("open_terminal", { hostId, path: path ?? null }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  uploadPublicKey: (hostId: string, password: string) => invoke<Host>("upload_public_key", { hostId, password }),
  probeConnection: (hostId: string) => invoke<string>("probe_connection", { hostId }),
  getHostFingerprint: (hostId: string) => invoke<string>("get_host_fingerprint", { hostId }),
  removeKnownHost: (hostId: string) => invoke<void>("remove_known_host", { hostId }),

  // System environment
  checkSsh: () => invoke<boolean>("check_ssh"),
  installOpenssh: () => invoke<void>("install_openssh"),

  // VS Code Remote-SSH
  vscodeStatus: () => invoke<VscodeStatus>("vscode_status"),
  vscodeOpen: (uri: string, hostId: string, label: string) => invoke<void>("vscode_open", { uri, hostId, label }),
  vscodeOpenDirect: (hostId: string) => invoke<VscodeOpenRootResult>("vscode_open_direct", { hostId }),
  vscodeOpenPath: (hostId: string, path: string) => invoke<VscodeOpenRootResult>("vscode_open_path", { hostId, path }),

  // Open history (ports / VS Code / terminal)
  listHistory: (hostId: string) => invoke<HistoryEntry[]>("list_history", { hostId }),

  // In-app auto-update (channel-aware, Rust side)
  checkUpdate: (channel: UpdateChannel) => invoke<UpdateInfo | null>("check_update", { channel }),
  installUpdate: (channel: UpdateChannel) => invoke<void>("install_update", { channel }),

  // Window / tray
  hideToTray: () => invoke<void>("hide_to_tray"),
  quitApp: () => invoke<void>("quit_app"),

  // Settings / logs
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings_cmd", { settings }),
  listLogs: (level: string) => invoke<LogEntry[]>("list_logs", { level }),
};
