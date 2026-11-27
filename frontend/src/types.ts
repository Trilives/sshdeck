export type TunnelMode = "local" | "remote" | "dynamic";
export type TunnelStatus = "running" | "stopped";
export type ThemeName = "dark" | "light" | "system";
export type AccentColor = "blue" | "violet" | "teal" | "orange" | "monochrome";
export type Language = "zh-CN" | "en-US";
export type LogLevel = "debug" | "info" | "warning" | "error";
/** What the window's close button does: prompt each time, minimize to tray, or quit. */
export type CloseBehavior = "ask" | "minimize" | "exit";
/** Which release channel the in-app updater checks: stable releases or preview pre-releases. */
export type UpdateChannel = "stable" | "preview";

/** Level 2: a single port forward (including view fields attached by the backend). */
export interface Forward {
  id: string;
  name: string;
  mode: TunnelMode;
  bindHost: string;
  bindPort: string;
  targetHost: string;
  targetPort: string;
  keepConnected: boolean;
  // View fields (attached when list/save returns)
  status?: TunnelStatus;
  bindDisplay?: string;
  targetDisplay?: string;
}

/** Level 1: an SSH server and its list of forwards. */
export interface Host {
  id: string;
  name: string;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  identityFile: string;
  extraOptions: string;
  // Jump host (ProxyJump), optional. Shaped like user@jump-host:port; use commas for multiple hops.
  proxyJump: string;
  forwards: Forward[];
  pinned: boolean;
  // View field: last-modified time (Unix ms), used for list sorting
  updatedAt?: number;
}

/** Import result: when status="conflict", includes the duplicate host names and requires the user to choose an overwrite strategy. */
export interface ImportResult {
  status: "done" | "conflict";
  duplicates: string[];
  added: number;
  overwritten: number;
  skipped: number;
}

export interface AppSettings {
  theme: ThemeName;
  accentColor: AccentColor;
  language: Language;
  logLevel: LogLevel;
  closeBehavior: CloseBehavior;
  autoSortHosts: boolean;
  twoColumnHosts: boolean;
  /** When true, an update found on startup installs automatically; when false, only a notice is shown. */
  autoUpdate: boolean;
  /** Which release channel to check for updates: stable (default) or preview (pre-releases). */
  updateChannel: UpdateChannel;
}

/** In-app auto-update flow state (see the updater plugin wiring in App.tsx / SettingsPage). */
export type UpdateStatus = "idle" | "checking" | "uptodate" | "available" | "downloading" | "restarting" | "error";
export interface UpdateState {
  status: UpdateStatus;
  /** Version offered by the release (when status is "available"/"downloading"/"restarting"). */
  version?: string;
  /** Release notes body for the available update. */
  notes?: string;
  /** Error message when status is "error". */
  error?: string;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
}

export interface CriticalErrorPayload {
  hostId: string;
  forwardId: string;
  name: string;
  message: string;
}

/** Install status of VS Code and the Remote-SSH extension. */
export interface VscodeStatus {
  installed: boolean;
  remoteSsh: boolean;
}

/** A single VS Code Remote-SSH history remote folder entry. */
export interface VscodeHistoryEntry {
  uri: string;
  path: string;
}

/** Result of a direct connect / open-root-directory action. */
export interface VscodeOpenRootResult {
  addedToConfig: boolean;
  alias: string;
  /** Folder URI opened (specific-path opens), used to record/reopen it; empty for a direct connect. */
  uri: string;
}

/** One entry in the local open-history (a port opened, a VS Code folder launched, or a terminal opened). */
export type HistoryKind = "vscode" | "terminal" | "terminal-path" | "port";
export interface HistoryEntry {
  id: string;
  hostId: string;
  kind: HistoryKind;
  label: string;
  /** VS Code folder URI (reopen a vscode entry as-is). Empty for other kinds. */
  uri: string;
  /** Browser URL for a port entry (so it can be reopened). Empty otherwise. */
  detail: string;
  openedAt: number;
}
