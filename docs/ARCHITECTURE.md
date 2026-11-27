# SSHDeck Architecture

Read this to get oriented before touching the code. For features and getting started as a user, see [../README.md](../README.md);
for when/how to split a file into a new module, see [MODULARITY.md](MODULARITY.md).

## 1. Overview

The core object is a **host-centric, two-level structure**:

- **Level 1 = Host**: an SSH server, storing connection parameters (host, port, user, key).
- **Level 2 = Forward**: a port forward nested under a host, storing only the forwarding parameters (mode, bind, target).

The host is a UI/data "object"; there is no reusable, persistent primary SSH connection (Windows' bundled OpenSSH doesn't
support ControlMaster multiplexing). What actually persists is each forward's own `ssh.exe` child process. "Send command",
"Open terminal", and "Upload key" each make a one-off `ssh` call as needed, reusing the host's connection parameters.

```mermaid
flowchart TB
  subgraph FE[React Frontend]
    Dash[Home/Dashboard] --> Cur[Current connections + key events]
    Remote[Remote Connections page] --> HostTransferActions
    Remote --> RemoteHostCard --> RemoteActions[Send command / Upload key / Open path / Edit host / Delete host]
    Forwarding[Port Forwarding page] --> HostCard --> ForwardRow
    HostCard --> ForwardActions[New forward / Disconnect host]
    Files[File Transfer page] --> FilePane[File panes and folder picker]
    Files --> TransferQueue
    FE --> Dlg[Dialogs: Host/Forward/SendCmd/Password/KeyUpload/HostKey]
    LogsPage[Logs page]
    SetPage[Settings page]
    GuidePage[Guide page]
    api[api.ts] -. invoke / listen .- FE
  end
  subgraph BE[Tauri 2 + Rust]
    cmds[commands/*] --> model[model + store: hosts.json]
    cmds --> ssh[ssh: command/process/probe/keys]
    cmds --> port[portcheck]
    cmds --> term[terminal: external PowerShell]
    cmds --> transfers[File sessions and transfer jobs]
    ssh --> sshexe[(ssh.exe forward child process)]
    term --> ps[(powershell -NoExit ssh ...)]
  end
  api == Tauri IPC ==> cmds
  cmds -. emit log-entry / critical-error .-> api
```

## 2. Tech Stack

- Desktop app shell and native backend: Tauri 2 + Rust
- Frontend UI: React + TypeScript + Tailwind CSS, local shadcn/ui-style components
- Forward execution: Rust calls the system `ssh`; the external terminal opens a PowerShell console running interactive `ssh`
- Target platform: **Windows only**. Packaging produces an NSIS installer with a Simplified Chinese / English selector and a changeable install directory, built by `.github/workflows/build.yml`.
  The backend calls Windows tooling directly (`powershell`, `netstat`/`tasklist`, `Add-WindowsCapability`, the registry)

## 3. Getting Started

Requires Node.js, npm, the Rust stable toolchain, and the Windows OpenSSH Client. If PowerShell doesn't recognize `cargo`/`rustc`,
add `%USERPROFILE%\.cargo\bin` to PATH.

```powershell
npm.cmd --prefix frontend install   # install deps (from project root)
.\frontend\node_modules\.bin\tauri.cmd dev   # run the dev build
cargo check --manifest-path src-tauri\Cargo.toml   # rust check
npm.cmd --prefix frontend run build # build the frontend only
```

Packaging must run from the **project root** (so the Tauri CLI finds `src-tauri/tauri.conf.json`); it builds the frontend
automatically via `beforeBuildCommand`:

```powershell
.\frontend\node_modules\.bin\tauri.cmd build
```

Output: `src-tauri\target\release\sshdeck.exe` and an NSIS installer under `src-tauri\target\release\bundle\nsis\`.

## 4. Data Model

```text
Host  (level 1 = SSH server)
├─ id, name, sshHost, sshPort (default 22), sshUser
├─ identityFile     // private key path; empty uses default id_ed25519
├─ extraOptions     // extra args applied to every ssh operation for this host
├─ proxyJump        // jump host (ProxyJump), optional; adds -J on connect
├─ pinned           // pinned hosts sort first
├─ updatedAt        // Unix ms; used when automatic host sorting is enabled
└─ forwards: Vec<Forward>

Forward (level 2 = a single port forward)
├─ id, name, mode: local | remote | dynamic
├─ bindHost (default 127.0.0.1), bindPort
├─ targetHost (default 127.0.0.1), targetPort   // not needed for dynamic
└─ keepConnected    // default true; auto-reconnect after disconnect
```

- Persistence files include `hosts.json` (forwards nested inside), `settings.json`, `history.json` (open history),
  and `transfer-folders.json` (recent source and destination directories by host).
- `AppSettings` also carries `closeBehavior` (`ask｜minimize｜exit`) — what the window close button does —
  `autoUpdate` (bool) — whether an update found on startup installs automatically — and `updateChannel`
  (`stable｜preview`) — which release channel the updater checks. It also stores `theme`, `accentColor`, and
  `autoSortHosts`. By default, manual order persists within pinned and unpinned groups. Editing forwards preserves host order.
- `HistoryEntry` carries `id`, `hostId`, `kind` (`vscode`, `terminal`, `terminal-path`, or `port`), `label`, `uri`, `detail`,
  and `openedAt`. Remote folders launched in Terminal or VS Code share one recent entry per host and path.
- The v0.1.x `profiles.json` **is not migrated**; if present, it's backed up to `profiles.json.v0.1.bak` on startup.
- Runtime state: `hosts: Mutex<Vec<Host>>`, `tunnels: Mutex<HashMap<ForwardId, ManagedTunnel>>` (one child process per running
  forward, with a snapshot of the parent host for auto-reconnect), plus `settings`, `logs`, and `history`.

## 5. Module Layout

### Backend `src-tauri/src/`

```text
main.rs            entry point + askpass helper
lib.rs             run(), Tauri Builder, single-instance / updater / process plugins, tray icon/menu, window-close handler, command registration, AppState wiring
model.rs           Host / Forward / enums / AppSettings / LogEntry / HistoryEntry / View / Default
app_data.rs        Windows data directory
store.rs           JSON reads and atomic writes
state.rs           AppState, persistence paths, logs, and folder history
host_order.rs      pinned grouping and manual/automatic host order
window_appearance.rs  Windows title bar colors and border visibility
validate.rs        validate_host / validate_forward / hostname_chars_ok (ASCII-only SSH host check)
portcheck.rs       local port-in-use detection + owning process name/PID (netstat + tasklist)
sshconfig.rs       parse/write ~/.ssh/config (import/export, find a VS Code alias by full connection profile)
vscode.rs          VS Code Remote-SSH: read history, match hosts, maintain exact-profile aliases, shape remote opens
vscode_launcher.rs Locate/launch VS Code and build its documented `--remote` CLI invocation
history.rs         open-history pure logic: upsert/dedup, merge scanned VS Code entries, sort by recency
terminal.rs        open_terminal: launches an external PowerShell window running ssh (optionally `cd`'d into a remote path)
ssh/
  command.rs       build_ssh / build_probe / build_key_upload / build_send command construction
  exec.rs          blocking one-off SSH execution and output capture
  worker.rs        cancellable command execution
  sftp.rs          SFTP session handling
  diagnose.rs      classify_ssh_failure: classify unreachable/auth/etc. failures from stderr, with localized reasons
  process.rs       start/stop/watch/cleanup tunnel, CREATE_NO_WINDOW, askpass helper
  readiness.rs     wait for a spawned tunnel to listen / reject immediate SSH startup failures
  probe.rs         probe_connection / get_host_fingerprint / remove_known_host
  keys.rs          ensure_public_key / resolve_identity_file / upload_key_to_remote
files/             file sessions, filesystem operations, direct access setup, and jobs
commands/          thin #[tauri::command] wrappers, one file per domain:
  hosts.rs forwards.rs exec.rs files.rs keys.rs settings.rs startup.rs transfer.rs vscode.rs system.rs history.rs update.rs window.rs
```

`window.rs` also exposes `show_main_window`, used by the tray and the single-instance callback to raise the running window.

### Frontend `frontend/src/`

```text
App.tsx              shell: page routing, data load/refresh, all action/dialog orchestration, theme
types.ts  api.ts  i18n.ts    shared types, IPC calls, UI copy (zh-CN/en-US)
pages/               DashboardPage RemoteConnectionsPage FileTransferPage PortForwardingPage LogsPage SettingsPage GuidePage
components/          AppSidebar PageHeader AppDialogs HostTransferActions HostCard ForwardRow StatusBadge LogTable dialogs.tsx ui/*
files/               file panes, folder picker, host selection, authentication, IPC, and queue
```

Dialogs of note in `components/dialogs/remote.tsx`: `RemoteConnectionDialog` (the per-host "Remote Connection" window — a list of
recent remote paths from Terminal and VS Code Remote-SSH, each openable in a terminal `cd`'d into it or in VS Code, plus a
retained manual path field with Terminal / VS Code buttons), and `CloseBehaviorDialog` (the minimize-to-tray vs
quit prompt).

Data loading, polling, and all dialog state are orchestrated centrally in `App.tsx`; pages and components stay purely
presentational (receiving data and callbacks via props). See [MODULARITY.md](MODULARITY.md) for the layering rules behind this split.
The shell owns viewport height. `AppSidebar` stays visible while the right-hand page scrolls. Its navigation entries form
a vertically centered group below the logo and name. The sidebar owns its
width preference, with a default of 232 CSS pixels and a 192–320 pixel range. Dragging the divider or using its
keyboard controls persists the value locally in WebView storage. Page headers sit above their content, and card
shadows use the active accent palette.

## 6. Tauri Commands

| Domain | Commands | Notes |
| --- | --- | --- |
| Host | `list_hosts` `save_host` `move_host` `set_host_pinned` `delete_host` | `move_host` reorders within a pin group. Deleting a host disconnects its forwards first. |
| Files | `open_file_session` `list_files` `close_file_session` `start_file_transfer` `list_file_transfers` `list_transfer_folders` `cancel_file_transfer` `setup_direct_access` | Browser sessions and cancellable transfers, with actual transfer folders tracked per endpoint |
| Import/export | `read_import_file` `read_import_ssh_config` `import_hosts` `export_hosts_to_file` `export_hosts_to_ssh_config` | dedup by sshHost/IP; strategy `""` detects conflicts, `overwrite`, or `skip` |
| Forward | `save_forward` `delete_forward` `connect_forward[_with_password]` `disconnect_forward` `disconnect_host` `disconnect_all` | connect probes first; port-in-use is only checked at connect time |
| Command/Terminal | `send_command` `open_terminal` `open_url` | `send_command` runs blocking SSH work through the async runtime's blocking pool, keeping IPC/UI responsive; `open_terminal(hostId, path?)` opens the shell (a non-empty `path` first `cd`s into it); `open_url` opens http/https in the default browser |
| Keys/Probe | `upload_public_key` `probe_connection` `get_host_fingerprint` `remove_known_host` | `probe_connection` returns `ready｜password_required｜host_key_changed`, or an Err with a reason for unreachable hosts |
| Settings/Logs | `get_settings` `save_settings_cmd` `list_logs` `get_launch_at_login` `set_launch_at_login` | The default appearance is light with a blue accent. Launch at login is opt-in. |
| System | `check_ssh` `install_openssh` | installs OpenSSH via elevated `Add-WindowsCapability` |
| VS Code | `vscode_status` `vscode_open` `vscode_open_direct` `vscode_open_path` | `vscode_open(uri, hostId, label)` reopens the path with the host's current full SSH profile, bumps the entry, and rescans; history is discovered by IP but connection aliases must also match user/port/key/ProxyJump |
| History | `list_history` | Merges VS Code history and returns a host’s entries by recency. Remote Connections shows `terminal-path` and `vscode` folder entries. |
| Update | `check_update` `install_update` | channel-aware; each builds the updater with the channel's endpoint (`stable` = releases/latest, `preview` = releases/download/preview/latest.json) and verifies the configured `pubkey` |
| Window | `hide_to_tray` `quit_app` | driven by the close prompt; the tray/single-instance raise the window in Rust |

Events: `log-entry` (one log line); `critical-error` (forward exited with code 255; payload has `hostId/forwardId/name/message`, frontend shows one dialog and stops auto-reconnect); `close-requested` (payload = whether forwards are running; the frontend shows the close/minimize prompt).

## 7. Key Flows

- **Automatic local port fallback** (local/dynamic only): `start_tunnel` calls `find_free_port`, incrementing from the
  configured `bindPort` up to 200 times. `detect_conflict` checks both this app's other running forwards and the OS
  (`netstat` + `tasklist`, ignoring this app's own `ssh.exe` PIDs). The actual port used overrides `bindPort`/`bindDisplay` in
  the view, so Home, the forward row, and "Open in browser" always point at what's really listening. Remote mode listens on
  the remote side, so no local check applies.
- **Connect / auto-reconnect**: `connect_forward` builds `ssh -N -T -L/-R/-D … user@host` and runs it with `CREATE_NO_WINDOW`;
  local/dynamic connections are reported as connected only after the listener accepts TCP (important for slower jump-host handshakes),
  while remote forwards are checked for immediate SSH startup failure;
  `watch_tunnel` polls the child and reconnects after a delay if `keepConnected` is on and the exit wasn't fatal (exit code 255
  → log + `critical-error`, no retry). Editing a running host/forward (`restart_forward`) reuses the cached password and does
  a stop-then-start.
- **One-time password connect**: frontend calls `probe_connection` first — `ready` connects directly, `password_required`
  prompts and calls `connect_forward_with_password` (password injected via `SSH_ASKPASS`, never written to disk, kept in
  memory only if `keepConnected`), `host_key_changed` shows the fingerprint and offers `remove_known_host` + retry.
- **External terminal**: `open_terminal` opens a visible, independent PowerShell window running interactive `ssh`; it's not
  tracked or cleaned up by the app. A non-empty `path` allocates a pty (`-t`) and `cd`s into that remote dir before the
  login shell. Successful launches record a `terminal-path` or plain `terminal` entry.
- **Remote Connection**: the per-host "Remote Connection" button (and the single Home icon) opens `RemoteConnectionDialog`.
  It lists the host's remote **paths** — `list_history` merges Remote-SSH's `state.vscdb` (preferred, freshest) with
  `storage.json` (fallback), matched to the host by IP. Clicking a record opens a terminal `cd`'d into that path; the
  VS Code button opens it in VS Code (`vscode_open` by URI, else `vscode_open_path`); the pen icon fills the manual field.
  The manual field opens a typed path with either tool — an empty VS Code open falls back to a direct connect
  (`vscode_open_path` → `open_direct_for_host`, which reuses or writes a matching `~/.ssh/config` alias); `~`/relative paths resolve
  against the remote `$HOME` via a one-time passwordless probe. Opening the dialog does not require VS Code; the
  install/Remote-SSH check happens only when a VS Code action is invoked.
- **Folder history**: opening a folder with Terminal or VS Code updates the shared per-host list. The file picker keeps
  separate transfer history and records source and destination folders after at least one file is written.
- **Native appearance**: on Windows 11, the main window’s title bar follows the selected appearance and accent. The
  desktop window manager suppresses the outer window border.
- **Close to tray / minimize**: `handle_close_requested` (a `WindowEvent::CloseRequested` handler) reads `closeBehavior` —
  `minimize` hides to the tray, `exit` quits when nothing is running, otherwise (or `exit` with forwards live) it prevents the
  close and emits `close-requested` so the UI can prompt. The tray menu offers Show/Quit; clicking the tray icon raises the window.
- **Single instance**: `tauri-plugin-single-instance` (registered first) focuses the running window instead of launching a
  second process.

- **In-app auto-update (channel-aware)**: check and install run in **Rust** (`commands/update.rs`), because the JS
  `check()` can only read the single static endpoint in `tauri.conf.json` — runtime channel selection needs
  `UpdaterExt::updater_builder().endpoints(...)`. `AppSettings.updateChannel` (`stable｜preview`) picks the endpoint:
  stable = `releases/latest/download/latest.json` (GitHub's non-prerelease latest), preview =
  `releases/download/preview/latest.json` (a rolling `preview` pre-release CI refreshes on every beta tag). On startup the
  frontend calls `check_update(channel)`; if a newer signed release exists and `autoUpdate` is on it calls
  `install_update(channel)` (which re-checks, `download_and_install`, then `app.restart()`); otherwise it shows the Home
  banner and the Settings entry, where "Download & install" runs the same command. Settings also offers a manual "Check for
  updates", the channel selector, and the auto-update toggle. The `tauri-plugin-updater` / `tauri-plugin-process` plugins
  stay registered (the Rust updater is built on the former). Releases are signed in CI with the key whose public half is
  pinned in `pubkey` (same key for both channels); the private key + password live in the
  `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]` repo secrets, `bundle.createUpdaterArtifacts` makes the build emit the signed
  archive and `latest.json`, and `.github/workflows/build.yml` publishes pre-release tags directly and mirrors their
  `latest.json` onto the `preview` release.
  Stable releases require a 48-hour wait after the latest numbered public preview. The release check and workflow
  are described in [AGENTS.md](../AGENTS.md).
- **Portable packaging**: `scripts/package-portable.ps1` packages the compiled `sshdeck.exe`, bilingual portable notes,
  license, and `portable.flag` into `SSHDeck_<version>_x64-portable.zip`. The same workflow uploads it beside the NSIS
  installer on tagged releases and includes it in smoke-build artifacts. Portable data remains in the normal system
  app-data directory, so this is install-free rather than a fully self-contained build.

On app exit, all forward child processes started by this app are cleaned up.

## 8. Data Storage

The backend resolves the operating system's per-user local app-data root with `directories::BaseDirs`, then writes
`hosts.json`, `settings.json`, `history.json`, `transfer-folders.json`, and `logs/` under `%LOCALAPPDATA%\SSHDeck\data` on Windows — never into
the source tree or the program's own folder. Config writes are atomic (temp file + rename). The legacy development-era
directory is intentionally not migrated. Users on v0.3.0-beta.4 or earlier should export their hosts before upgrading and import them afterward.
