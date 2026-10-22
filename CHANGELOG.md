# Changelog

## 0.4.0-beta.6

**Added**
- Open a selected remote folder directly in Terminal or VS Code from the folder picker.
- Connect file browsers with a one-time password or upload this computer's public key from the authentication dialog.
- Set up direct SSH access per recipient from transfer confirmation: generate a dedicated source-server key if needed, authorize its public key on the destination, and verify the connection. Private keys stay on their server; passwords are requested only when needed.

**Fixed**
- Detect existing passwordless access before uploading keys or configuring direct access, and skip all key changes when it already works.
- Bound key-upload SSH waits so unavailable networks cannot leave setup waiting indefinitely.

**Tests**
- Cover folder launch actions, password/key-upload retry, direct-access password prompts and multiple recipients. Execute key-generation and authorization scripts against isolated temporary folders to verify deduplication and private-key isolation.

## 0.4.0-beta.5

**Fixed**
- Anchor all dialogs to the window viewport so long or scrolled pages cannot push them below the visible area.
- Keep oversized dialog content scrollable inside the window, including smaller windows and stacked password prompts.

**Tests**
- Add layout checks for directory pickers on long pages, window resizing, long forms, dark mode and nested dialogs.

## 0.4.0-beta.4

**Fixed**
- Fix a deferred scroll update that could clear the entire UI when browsing directories or switching file-transfer hosts.
- Keep navigation and the close confirmation available if the file-transfer page encounters a rendering error, with an option to reopen the page.

**Tests**
- Add browser regression coverage for scrolling and host changes, connection failures, password prompts, late connections, double-click navigation, and recovery after a rendering error. Run it before packaging releases.

## 0.4.0-beta.2

**Changed**
- Choose folders in a single dialog with an expandable root-to-folder tree, recent folders, and existing remote connection history. Navigation only applies after confirmation.
- Use the same folder picker in Remote Connections to choose the working directory for SSH terminals and VS Code.
- Move the direct-transfer toggle into the transfer confirmation dialog and rename it to **Bypass this computer / 不经过本机**.
- Refresh English/Chinese README screenshots and shorten Features to focus on everyday use.

**Fixed**
- Ignore repeated activation of ordinary files, keep directory double-click navigation, and reject non-directory browse requests without losing the file connection.

## 0.4.0-beta.1

**Added**
- Dedicated file transfer page with local/SFTP directory trees, multiple selection, drag and drop, recursive folder copies, and skip/overwrite/keep-both policies.
- Background transfer queue with progress, speed, ETA, cancellation and retry; transfers continue when navigating between pages.
- Optional distribution mode with multiple recipients and individual destination folders.
- Optional direct transfers between remote hosts, with estimated progress and an indicator that file contents bypass this computer. The source must have `sftp`, passwordless destination access, and a trusted destination host key.

**Fixed**
- Move connection probes and key operations off the UI thread, bound one-off command execution to 120 seconds, cap captured output, and allow cancelling commands during poor network conditions.
- Prevent a cancellation arriving before command registration from being lost; guard application exit while transfers or commands are active.

**Preview notes**
- Symbolic links and special files are not copied. Replacing remote files requires the OpenSSH `posix-rename` extension.
- Direct transfers require server-side authentication and reachability; local private keys and jump-host settings are not forwarded to the source.

## 0.3.1

**Fixed**
- Open remote folders with VS Code's documented `--remote` CLI form and preserve non-ASCII/special-character paths.
- Keep direct and ProxyJump connections to the same IP on separate SSH config aliases, and reopen history with the host's current connection profile.
- Wait for local/dynamic SSH listeners to become reachable before reporting a forward as connected, avoiding jump-host startup races.

## 0.3.1-beta.2

**Fixed**
- Open remote folders with VS Code's documented `--remote` CLI form and preserve non-ASCII/special-character paths.
- Keep direct and ProxyJump connections to the same IP on separate SSH config aliases, and reopen history with the host's current connection profile.
- Wait for local/dynamic SSH listeners to become reachable before reporting a forward as connected, avoiding jump-host startup races.

## 0.3.0

**Added**
- Dedicated **Remote Connections** and **Port Forwarding** pages with host-grouped history, terminal / VS Code actions, and Local / Remote / Dynamic forwarding management.
- Signed in-app updates with Stable and Preview channels, plus an install-free Windows portable ZIP published beside the installer.

**Changed**
- Consolidated New Host, import/export, command, key upload, host editing/deletion, and pin/unpin controls under Remote Connections while keeping forwarding-specific actions on Port Forwarding.
- Unified host headers across both management pages, moved Delete Host to the far right of the expanded Remote Connections action row, and kept the sidebar fixed while only page content scrolls.
- Applied the native Windows Mica backdrop and replaced page-top operation messages with five-second floating toasts.
- Moved per-user data to `%LOCALAPPDATA%\SSHDeck\data` and refreshed the English/Chinese multi-page README previews.
- Made the NSIS installer language selector and current-user installation mode explicit; fresh setup allows changing the installation directory while in-app upgrades retain it and replace the existing installation in place.

**Fixed**
- One-off SSH commands run on a blocking worker so the interface remains responsive while remote commands execute.
- Prevented stale command results from overwriting newer dialogs and fixed narrow-window Chinese layout clipping.

**Upgrade notice**
- When upgrading directly from beta.4 or earlier, export hosts before updating and import them afterward. The old data directory is not migrated automatically; settings and connection history start fresh.

## 0.3.0-beta.6

**Changed**
- Applied the native Windows Mica backdrop with a translucent app surface while retaining the standard title bar, resizing, and system window controls.
- Replaced page-top operation messages with floating success/error toasts that can be dismissed manually and disappear automatically after five seconds.

## 0.3.0-beta.5

**Fixed**
- Replaced the legacy development-era data path with `%LOCALAPPDATA%\SSHDeck\data`, independent of the source repository, developer name, and installation directory.

**Upgrade notice**
- There is no automatic migration from beta.4 or earlier. Export hosts before updating, then import them after launching beta.5. Settings and connection history start fresh in the new directory.

## 0.3.0-beta.4

**Added**
- Published a Windows install-free portable ZIP beside the installer from the same CI build.

**Changed**
- Moved Delete Host into each Remote Connections host item, keeping host lifecycle actions out of Port Forwarding.
- Refreshed the English and Chinese README preview composites after the final page-action layout changes.

## 0.3.0-beta.3

**Added**
- Dedicated **Remote Connections** page, grouped by host, with historical remote paths and Terminal / VS Code reopen actions.
- Dedicated **Port Forwarding** page, grouped by host, for Local, Remote, and Dynamic forwarding management.
- Automated Windows portable ZIP packaging, published beside the installer from the same CI build.

**Fixed**
- One-off SSH commands now run on a blocking worker instead of the Tauri IPC runtime, so the interface remains responsive while a remote command is running.
- Closing a running command dialog no longer lets its eventual result overwrite a newly opened host command dialog.
- Chinese layouts can shrink and wrap correctly in narrower windows without clipping right-side actions.
- The sidebar now stays fixed while only the right-hand page content scrolls.

**Changed**
- Moved host import/export, New Host, Upload Key, and Delete Host actions to Remote Connections; Port Forwarding now keeps only forwarding actions and adds one-click host disconnect.
- Replaced the outdated README screenshots with four current 1440×900 English/Chinese page previews and refreshed the architecture documentation.
- Split navigation, dialog orchestration, remote dialogs, and SSH execution into focused modules to keep files within the project's modularity limits.

## 0.3.0-beta.2

**Added**
- **Remote Connection**: each host now has a single "Remote Connection" button (and one icon on Home) opening a list of remote paths (from VS Code Remote-SSH history, matched by IP). Open any path in a terminal — SSH'd and `cd`'d into it — or in VS Code, or type a path manually. Enter opens a terminal, Esc closes.
- **Preview / Stable update channels**: pick which release channel the in-app updater follows in **Settings → Software Update**. Update checks and installs now run channel-aware in the backend.

**Changed**
- The per-host terminal split button and the separate "Open in VS Code" dialog are replaced by the unified Remote Connection window.

**Notes**
- Pre-release. The Preview channel starts resolving once a preview build has been published.

## 0.3.1-beta.1

**Added**
- In-app auto-update: **Settings → Software Update** checks GitHub Releases, shows the new version and its notes, and installs a newer signed build in place (then restarts). Powered by `tauri-plugin-updater` + `tauri-plugin-process`; releases are signed in CI and verified against a pinned public key.
- **Automatic updates** toggle in Settings. When on, an update found at startup installs silently; when off, a small "update available" notice appears on the main screen.

**Changed**
- Project renamed to **SSHDeck** (binary `sshdeck.exe`, product name `SSHDeck`).

**Notes**
- Pre-release. Existing settings and hosts are preserved (the app identifier and data directory are unchanged).
- Auto-update requires the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets to be set so CI can sign the release and publish `latest.json`.
