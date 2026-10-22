import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "./api";
import { forwardWebUrl } from "./lib/utils";
import { t } from "./i18n";
import { AppSidebar, type AppPage } from "./components/AppSidebar";
import { AppDialogs } from "./components/AppDialogs";
import { ToastNotifications } from "./components/ToastNotifications";
import { DashboardPage } from "./pages/DashboardPage";
import { PortForwardingPage } from "./pages/PortForwardingPage";
import { RemoteConnectionsPage } from "./pages/RemoteConnectionsPage";
import { LogsPage } from "./pages/LogsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { GuidePage } from "./pages/GuidePage";
import { FileTransferPage } from "./pages/FileTransferPage";
import { FileTransferBoundary } from "./files/FileTransferBoundary";
import type { AppSettings, CriticalErrorPayload, Forward, HistoryEntry, Host, LogEntry, LogLevel, UpdateChannel, UpdateState } from "./types";

const defaultSettings: AppSettings = { theme: "light", language: "zh-CN", logLevel: "info", closeBehavior: "ask", autoUpdate: false, updateChannel: "stable" };

const newHost = (): Host => ({
  id: "",
  name: "",
  sshHost: "",
  sshPort: "22",
  sshUser: "",
  identityFile: "",
  extraOptions: "",
  proxyJump: "",
  forwards: [],
  pinned: false,
});

const newForward = (): Forward => ({
  id: crypto.randomUUID(),
  name: "",
  mode: "local",
  bindHost: "127.0.0.1",
  bindPort: "",
  targetHost: "127.0.0.1",
  targetPort: "",
  keepConnected: true,
});

export function App() {
  const [page, setPage] = useState<AppPage>("dashboard");
  const [hosts, setHosts] = useState<Host[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [forwardingExpandedIds, setForwardingExpandedIds] = useState<Set<string>>(new Set());
  const [remoteExpandedIds, setRemoteExpandedIds] = useState<Set<string>>(new Set());
  const [remoteHistories, setRemoteHistories] = useState<Record<string, HistoryEntry[]>>({});
  const [remoteLoadingIds, setRemoteLoadingIds] = useState<Set<string>>(new Set());

  // Dialogs
  const [hostDialog, setHostDialog] = useState<Host | null>(null);
  const [forwardDialog, setForwardDialog] = useState<{ hostId: string; draft: Forward } | null>(null);
  const [sendCmd, setSendCmd] = useState<{ hostId: string; hostName: string } | null>(null);
  const [command, setCommand] = useState("");
  const [commandOutput, setCommandOutput] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const commandRunId = useRef(0);
  const activeCommand = useRef<string | null>(null);
  const [sendCmdPwOpen, setSendCmdPwOpen] = useState(false);
  const [sendCmdPwValue, setSendCmdPwValue] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<{ host: Host; forward: Forward } | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [keyUploadTarget, setKeyUploadTarget] = useState<Host | null>(null);
  const [keyUploadPassword, setKeyUploadPassword] = useState("");
  const [hostKeyTarget, setHostKeyTarget] = useState<{ host: Host; forward?: Forward; action: "connect" | "upload" } | null>(null);
  const [hostKeyFingerprint, setHostKeyFingerprint] = useState("");
  const [hostKeyFetching, setHostKeyFetching] = useState(false);
  const [criticalError, setCriticalError] = useState<CriticalErrorPayload | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // Import/export: host-selection dialog and duplicate-conflict dialog.
  const [selectHosts, setSelectHosts] = useState<{
    mode: "import" | "export-file" | "export-config";
    items: Host[];
    selected: Set<string>;
  } | null>(null);
  const [importConflict, setImportConflict] = useState<{
    duplicates: string[];
    hosts: Host[];
    mode: "import" | "export-config";
  } | null>(null);
  const [deleteHostTarget, setDeleteHostTarget] = useState<Host | null>(null);
  const [sshMissing, setSshMissing] = useState(false);
  // Open history: combined VS Code / terminal / port history window + VS Code not-installed prompt.
  const [historyDialog, setHistoryDialog] = useState<{ host: Host; entries: HistoryEntry[] } | null>(null);
  const [vscodeMissing, setVscodeMissing] = useState<"vscode" | "remoteSsh" | null>(null);
  // Close-button prompt (minimize to tray vs quit); `active` = forwards still running.
  const [closePrompt, setClosePrompt] = useState<{ active: boolean } | null>(null);
  const shownCriticalErrors = useRef(new Set<string>());
  // In-app auto-update (Settings page): current version, flow state, and the pending Update handle to install.
  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const didStartupUpdateCheck = useRef(false);

  const language = settings.language;
  const modalOpen = Boolean(
    hostDialog || forwardDialog || sendCmd || passwordTarget || keyUploadTarget || hostKeyTarget || criticalError || connectError || selectHosts || importConflict || deleteHostTarget || sshMissing || historyDialog || vscodeMissing || closePrompt,
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

  // Idle timer only runs on the Port Forwarding page with no dialog open: 3 minutes of no activity jumps back to Home.
  useEffect(() => {
    if (page !== "forwarding" || modalOpen) return;
    let timer = 0;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPage("dashboard"), 3 * 60 * 1000);
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [page, modalOpen]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<CriticalErrorPayload>("critical-error", (event) => {
      if (shownCriticalErrors.current.has(event.payload.forwardId)) return;
      shownCriticalErrors.current.add(event.payload.forwardId);
      setCriticalError(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  // The backend prevents the window close and asks us to prompt (behavior "ask", or "exit" with forwards running).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<boolean>("close-requested", (event) => {
      setClosePrompt({ active: event.payload });
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    void api.checkSsh().then((available) => {
      if (!available) setSshMissing(true);
    });
  }, []);

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // One startup update check: with auto-update on, install silently; otherwise surface a banner on Home.
  useEffect(() => {
    if (didStartupUpdateCheck.current) return;
    didStartupUpdateCheck.current = true;
    void startupUpdateCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshAll();
    const timer = window.setInterval(() => {
      void refreshHosts();
      void refreshLogs(settings.logLevel);
    }, 1500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.logLevel]);

  async function refreshAll() {
    try {
      const [nextSettings, nextHosts] = await Promise.all([api.getSettings(), api.listHosts()]);
      setSettings(nextSettings);
      setHosts(nextHosts);
      await refreshLogs(nextSettings.logLevel);
    } catch (err) {
      setError(String(err));
    }
  }

  async function refreshHosts() {
    try {
      setHosts(await api.listHosts());
    } catch (err) {
      setError(String(err));
    }
  }

  async function refreshLogs(level: LogLevel) {
    try {
      setLogs(await api.listLogs(level));
    } catch {
      /* ignore transient */
    }
  }

  async function updateSettings(next: Partial<AppSettings>) {
    try {
      setSettings(await api.saveSettings({ ...settings, ...next }));
    } catch (err) {
      setError(String(err));
    }
  }

  function toggleForwardingExpand(hostId: string) {
    setForwardingExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) next.delete(hostId);
      else next.add(hostId);
      return next;
    });
  }

  async function refreshRemoteHistory(host: Host) {
    setRemoteLoadingIds((prev) => new Set(prev).add(host.id));
    try {
      const entries = (await api.listHistory(host.id)).filter((entry) => entry.kind === "vscode");
      setRemoteHistories((prev) => ({ ...prev, [host.id]: entries }));
    } catch (err) {
      setError(String(err));
    } finally {
      setRemoteLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(host.id);
        return next;
      });
    }
  }

  function toggleRemoteHost(host: Host) {
    const opening = !remoteExpandedIds.has(host.id);
    setRemoteExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(host.id)) next.delete(host.id);
      else next.add(host.id);
      return next;
    });
    if (opening) void refreshRemoteHistory(host);
  }

  function expand(hostId: string) {
    setForwardingExpandedIds((prev) => new Set(prev).add(hostId));
  }

  // ---- Host CRUD ----
  async function saveHost() {
    if (!hostDialog) return;
    try {
      const saved = await api.saveHost(hostDialog);
      setHostDialog(null);
      setError("");
      await refreshHosts();
      expand(saved.id);
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggleHostPin(host: Host) {
    try {
      await api.setHostPinned(host.id, !host.pinned);
      await refreshHosts();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Import / Export ----
  function openSelectHosts(mode: "import" | "export-file" | "export-config", items: Host[]) {
    setError("");
    setSelectHosts({ mode, items, selected: new Set(items.map((h) => h.id)) });
  }

  async function importFromFile() {
    try {
      const parsed = await api.readImportFile();
      if (parsed.length === 0) return; // user canceled or the file was empty
      openSelectHosts("import", parsed);
    } catch (err) {
      setError(String(err));
    }
  }

  async function importFromConfig() {
    try {
      openSelectHosts("import", await api.readImportSshConfig());
    } catch (err) {
      setError(String(err));
    }
  }

  function toggleSelectHost(id: string) {
    setSelectHosts((prev) => {
      if (!prev) return prev;
      const selected = new Set(prev.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...prev, selected };
    });
  }

  async function confirmSelectHosts() {
    if (!selectHosts) return;
    const { mode, items, selected } = selectHosts;
    const chosen = items.filter((h) => selected.has(h.id));
    setSelectHosts(null);
    try {
      if (mode === "import") {
        const result = await api.importHosts(chosen, "");
        if (result.status === "conflict") {
          setImportConflict({ duplicates: result.duplicates, hosts: chosen, mode: "import" });
          return;
        }
        await finishImport(result);
      } else if (mode === "export-file") {
        const saved = await api.exportHostsToFile(chosen.map((h) => h.id));
        if (saved) setNotice(t(language, "exportDone"));
      } else {
        const result = await api.exportHostsToSshConfig(chosen.map((h) => h.id), "");
        if (result.status === "conflict") {
          setImportConflict({ duplicates: result.duplicates, hosts: chosen, mode: "export-config" });
          return;
        }
        setNotice(t(language, "exportConfigDone"));
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function applyImportStrategy(strategy: "overwrite" | "skip") {
    if (!importConflict) return;
    const { hosts, mode } = importConflict;
    setImportConflict(null);
    try {
      if (mode === "export-config") {
        await api.exportHostsToSshConfig(hosts.map((h) => h.id), strategy);
        setNotice(t(language, "exportConfigDone"));
      } else {
        await finishImport(await api.importHosts(hosts, strategy));
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function finishImport(result: { added: number; overwritten: number; skipped: number }) {
    await refreshHosts();
    setNotice(
      t(language, "importDone")
        .replace("{added}", String(result.added))
        .replace("{overwritten}", String(result.overwritten))
        .replace("{skipped}", String(result.skipped)),
    );
  }

  async function confirmDeleteHost() {
    if (!deleteHostTarget) return;
    const host = deleteHostTarget;
    setDeleteHostTarget(null);
    try {
      await api.deleteHost(host.id);
      await refreshHosts();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Forward CRUD ----
  async function saveForward() {
    if (!forwardDialog) return;
    const { hostId, draft } = forwardDialog;
    try {
      const updatedHost = await api.saveForward(hostId, draft);
      setForwardDialog(null);
      setError("");
      await refreshHosts();
      expand(hostId);
      // If "keep connected" is checked and this forward isn't currently running, auto-start it after saving
      // (edits to a running forward are already reconnected by the backend, so skip to avoid double-connecting).
      if (draft.keepConnected) {
        const forward = updatedHost.forwards.find((item) => item.id === draft.id);
        if (forward && forward.status !== "running") await connectForward(updatedHost, forward);
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteForward(host: Host, forward: Forward) {
    try {
      await api.deleteForward(host.id, forward.id);
      await refreshHosts();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Connect flow ----
  async function connectForward(host: Host, forward: Forward) {
    setError("");
    setNotice(t(language, "detectingConnection"));
    try {
      const status = await api.probeConnection(host.id);
      setNotice("");
      if (status === "host_key_changed") {
        await openHostKeyDialog(host, "connect", forward);
        return;
      }
      if (status === "password_required") {
        setPasswordTarget({ host, forward });
        setPasswordValue("");
        return;
      }
      await api.connectForward(host.id, forward.id);
      await refreshHosts();
    } catch (err) {
      setNotice("");
      // Probe/connect failed (unreachable, bad IP/port, network, etc.): show the specific reason in a dialog.
      setConnectError(String(err));
    }
  }

  async function connectWithPassword() {
    if (!passwordTarget || !passwordValue) return;
    try {
      await api.connectForwardWithPassword(passwordTarget.host.id, passwordTarget.forward.id, passwordValue);
      setPasswordTarget(null);
      setPasswordValue("");
      setError("");
      await refreshHosts();
    } catch (err) {
      setError(String(err));
    }
  }

  async function disconnectForward(host: Host, forward: Forward) {
    try {
      await api.disconnectForward(host.id, forward.id);
      await refreshHosts();
    } catch (err) {
      setError(String(err));
    }
  }

  async function disconnectHost(host: Host) {
    try {
      await api.disconnectHost(host.id);
      await refreshHosts();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Key upload flow (host level) ----
  async function requestKeyUpload(host: Host) {
    setError("");
    setNotice(t(language, "detectingConnection"));
    try {
      const status = await api.probeConnection(host.id);
      setNotice("");
      if (status === "ready") {
        setNotice(t(language, "keyUploadNotNeeded"));
        return;
      }
      if (status === "host_key_changed") {
        await openHostKeyDialog(host, "upload");
        return;
      }
      setKeyUploadTarget(host);
      setKeyUploadPassword("");
    } catch (err) {
      setNotice("");
      setConnectError(String(err));
    }
  }

  async function uploadKeyWithPassword() {
    if (!keyUploadTarget || !keyUploadPassword) return;
    try {
      await api.uploadPublicKey(keyUploadTarget.id, keyUploadPassword);
      setKeyUploadTarget(null);
      setKeyUploadPassword("");
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Host key changed flow ----
  async function openHostKeyDialog(host: Host, action: "connect" | "upload", forward?: Forward) {
    setHostKeyTarget({ host, action, forward });
    setHostKeyFingerprint("");
    setHostKeyFetching(true);
    try {
      setHostKeyFingerprint(await api.getHostFingerprint(host.id));
    } catch {
      setHostKeyFingerprint("");
    } finally {
      setHostKeyFetching(false);
    }
  }

  async function trustHostKeyAndRetry() {
    if (!hostKeyTarget) return;
    const { host, forward, action } = hostKeyTarget;
    setHostKeyTarget(null);
    try {
      await api.removeKnownHost(host.id);
      if (action === "connect" && forward) {
        await connectForward(host, forward);
      } else {
        await requestKeyUpload(host);
      }
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Send command ----
  async function runSendCommand() {
    if (!sendCmd || !command.trim() || activeCommand.current) return;
    const operationId = crypto.randomUUID();
    activeCommand.current = operationId;
    const runId = ++commandRunId.current;
    const target = sendCmd;
    const remoteCommand = command;
    setCommandBusy(true);
    setCommandOutput("");
    try {
      const output = await api.sendCommand(target.hostId, remoteCommand, operationId);
      if (commandRunId.current === runId) setCommandOutput(output);
    } catch (err) {
      if (commandRunId.current === runId) setCommandOutput(String(err));
    } finally {
      if (activeCommand.current === operationId) activeCommand.current = null;
      if (commandRunId.current === runId) setCommandBusy(false);
    }
  }

  async function runSendCommandWithPassword() {
    if (!sendCmd || !command.trim() || !sendCmdPwValue || activeCommand.current) return;
    const operationId = crypto.randomUUID();
    activeCommand.current = operationId;
    const password = sendCmdPwValue;
    const runId = ++commandRunId.current;
    const target = sendCmd;
    const remoteCommand = command;
    setSendCmdPwOpen(false);
    setSendCmdPwValue("");
    setCommandBusy(true);
    setCommandOutput("");
    try {
      const output = await api.sendCommandWithPassword(target.hostId, remoteCommand, password, operationId);
      if (commandRunId.current === runId) setCommandOutput(output);
    } catch (err) {
      if (commandRunId.current === runId) setCommandOutput(String(err));
    } finally {
      if (activeCommand.current === operationId) activeCommand.current = null;
      if (commandRunId.current === runId) setCommandBusy(false);
    }
  }

  function openSendCommand(host: Host) {
    cancelSendCommand();
    commandRunId.current += 1;
    setSendCmd({ hostId: host.id, hostName: host.name });
    setCommand("");
    setCommandOutput("");
    setSendCmdPwOpen(false);
    setSendCmdPwValue("");
    setCommandBusy(false);
  }

  function closeSendCommand() {
    cancelSendCommand();
    commandRunId.current += 1;
    setSendCmd(null);
    setSendCmdPwOpen(false);
    setSendCmdPwValue("");
    setCommandBusy(false);
  }

  function cancelSendCommand() {
    if (activeCommand.current) void api.cancelCommand(activeCommand.current).catch(() => {});
    activeCommand.current = null;
    commandRunId.current += 1;
    setCommandBusy(false);
    setCommandOutput(language === "zh-CN" ? "操作已取消。" : "Operation cancelled.");
  }

  async function openForwardWeb(forward: Forward) {
    try {
      await api.openUrl(forwardWebUrl(forward));
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Remote connection (terminal / VS Code, by remote path) ----
  // Open the dialog with the host's remote-path history. This works without VS Code installed; the VS Code
  // install/Remote-SSH check happens only when a VS Code action is invoked.
  async function openRemoteConnection(host: Host) {
    setError("");
    try {
      // Loading history also rescans VS Code's own history and merges anything new (backend side).
      const entries = (await api.listHistory(host.id)).filter((entry) => entry.kind === "vscode");
      setHistoryDialog({ host, entries });
    } catch (err) {
      setError(String(err));
    }
  }

  // Prompt if VS Code / Remote-SSH is missing; returns whether a VS Code action may proceed.
  async function ensureVscode(): Promise<boolean> {
    const status = await api.vscodeStatus();
    if (!status.installed) {
      setVscodeMissing("vscode");
      return false;
    }
    if (!status.remoteSsh) {
      setVscodeMissing("remoteSsh");
      return false;
    }
    return true;
  }

  // Open a terminal `cd`'d into a remote path (empty path = plain shell at home).
  async function openTerminalPath(host: Host, path: string) {
    setHistoryDialog(null);
    try {
      await api.openTerminal(host.id, path.trim() || undefined);
    } catch (err) {
      setError(String(err));
    }
  }

  // Open a remote path in VS Code (empty path = direct connect, via the backend's empty-path fallback).
  async function openVscodePath(host: Host, path: string) {
    try {
      if (!(await ensureVscode())) return;
      const result = await api.vscodeOpenPath(host.id, path.trim());
      setHistoryDialog(null);
      if (result.addedToConfig) {
        setNotice(t(language, "vscodeAddedToConfig").replace("{alias}", result.alias));
      }
    } catch (err) {
      setHistoryDialog(null);
      setError(String(err));
    }
  }

  // Open a recorded path entry in VS Code, reusing its folder URI when present (else recompute from the path).
  async function openVscodeEntry(host: Host, entry: HistoryEntry) {
    if (!entry.uri) {
      await openVscodePath(host, entry.label);
      return;
    }
    try {
      if (!(await ensureVscode())) return;
      await api.vscodeOpen(entry.uri, host.id, entry.label);
      setHistoryDialog(null);
    } catch (err) {
      setHistoryDialog(null);
      setError(String(err));
    }
  }

  // ---- Close-button prompt (minimize to tray vs quit) ----
  async function minimizeToTray(remember: boolean) {
    setClosePrompt(null);
    if (remember) await updateSettings({ closeBehavior: "minimize" });
    await api.hideToTray();
  }

  async function exitApp(remember: boolean) {
    if (remember) await updateSettings({ closeBehavior: "exit" });
    setClosePrompt(null);
    await api.quitApp();
  }

  async function installSsh() {
    setSshMissing(false);
    try {
      await api.installOpenssh();
      setNotice(t(language, "sshInstallStarted"));
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- In-app auto-update (channel-aware; check/install run in Rust) ----
  // Runs once at startup. Reads the freshest settings (state may still be default at mount), then either
  // installs automatically or leaves an "available" update for the Home banner / Settings.
  async function startupUpdateCheck() {
    try {
      const settings = await api.getSettings();
      const found = await api.checkUpdate(settings.updateChannel);
      if (!found) return;
      if (settings.autoUpdate) {
        await installUpdate(settings.updateChannel);
      } else {
        setUpdateDismissed(false);
        setUpdate({ status: "available", version: found.version, notes: found.notes });
      }
    } catch {
      /* Silent on startup; the user can still check manually in Settings. */
    }
  }

  async function checkForUpdate() {
    setUpdate({ status: "checking" });
    try {
      const found = await api.checkUpdate(settings.updateChannel);
      if (found) {
        setUpdateDismissed(false);
        setUpdate({ status: "available", version: found.version, notes: found.notes });
      } else {
        setUpdate({ status: "uptodate" });
      }
    } catch (err) {
      setUpdate({ status: "error", error: String(err) });
    }
  }

  // The Rust command re-checks the channel, downloads/installs, and relaunches (so this call won't return on success).
  async function installUpdate(channel: UpdateChannel) {
    setUpdate({ status: "downloading", version: update.version });
    try {
      await api.installUpdate(channel);
      setUpdate({ status: "restarting", version: update.version });
    } catch (err) {
      setUpdate({ status: "error", error: String(err) });
    }
  }

  const dialogProps = {
    language, hostDialog, setHostDialog, saveHost, forwardDialog, setForwardDialog, saveForward,
    sendCmd, command, setCommand, commandOutput, commandBusy, closeSendCommand, runSendCommand,
    sendCmdPwOpen, setSendCmdPwOpen, sendCmdPwValue, setSendCmdPwValue, runSendCommandWithPassword,
    passwordTarget, setPasswordTarget, passwordValue, setPasswordValue, connectWithPassword,
    cancelSendCommand,
    keyUploadTarget, setKeyUploadTarget, keyUploadPassword, setKeyUploadPassword, uploadKeyWithPassword,
    hostKeyTarget, setHostKeyTarget, hostKeyFingerprint, hostKeyFetching, trustHostKeyAndRetry,
    criticalError, setCriticalError, connectError, setConnectError, selectHosts, setSelectHosts,
    toggleSelectHost, confirmSelectHosts, importConflict, setImportConflict, applyImportStrategy,
    deleteHostTarget, setDeleteHostTarget, confirmDeleteHost, sshMissing, setSshMissing, installSsh,
    historyDialog, setHistoryDialog, openTerminalPath, openVscodeEntry, openVscodePath,
    vscodeMissing, setVscodeMissing, closePrompt, setClosePrompt, minimizeToTray, exitApp,
  };

  return (
    <main className="h-screen overflow-hidden bg-slate-50/90 text-slate-950 backdrop-blur-xl transition duration-300 dark:bg-[#090d18]/90 dark:text-slate-50">
      <ToastNotifications language={language} error={error} notice={notice} setError={setError} setNotice={setNotice} />
      <div className="flex h-full min-h-0">
        <AppSidebar language={language} page={page} onNavigate={setPage} />

        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
          {page === "dashboard" && update.status === "available" && !updateDismissed && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-950 dark:bg-blue-950/40 dark:text-blue-200">
              <span className="whitespace-pre-wrap">{t(language, "updateBannerText").replace("{version}", update.version ?? "")}</span>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => installUpdate(settings.updateChannel)} className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500">
                  {t(language, "updateNow")}
                </button>
                <button onClick={() => setUpdateDismissed(true)} className="text-blue-400 hover:text-blue-600">✕</button>
              </div>
            </div>
          )}
          <div className="animate-[fadeIn_220ms_ease-out]">
            <div className={page === "files" ? "" : "hidden"}>
              <FileTransferBoundary language={language}>
                <FileTransferPage language={language} hosts={hosts} active={page === "files"} />
              </FileTransferBoundary>
            </div>
            {page === "dashboard" && (
              <DashboardPage
                language={language}
                hosts={hosts}
                logs={logs}
                onNew={() => {
                  setPage("forwarding");
                  setHostDialog(newHost());
                }}
                onStopAll={async () => {
                  await api.disconnectAll();
                  await refreshHosts();
                }}
                onDisconnectForward={disconnectForward}
                onOpenForwardWeb={(_host, forward) => openForwardWeb(forward)}
                onOpenRemoteConnection={openRemoteConnection}
              />
            )}
            {page === "remote" && (
              <RemoteConnectionsPage
                language={language}
                hosts={hosts}
                histories={remoteHistories}
                expandedIds={remoteExpandedIds}
                loadingIds={remoteLoadingIds}
                onNewHost={() => setHostDialog(newHost())}
                onImportFromFile={importFromFile}
                onImportFromConfig={importFromConfig}
                onExportToFile={() => openSelectHosts("export-file", hosts)}
                onExportToConfig={() => openSelectHosts("export-config", hosts)}
                onToggle={toggleRemoteHost}
                onTogglePin={toggleHostPin}
                onEditHost={(host) => setHostDialog(host)}
                onDeleteHost={(host) => setDeleteHostTarget(host)}
                onRefresh={(host) => void refreshRemoteHistory(host)}
                onSendCommand={openSendCommand}
                onUploadKey={requestKeyUpload}
                onOpenTerminalEntry={(host, entry) => openTerminalPath(host, entry.label)}
                onOpenVscodeEntry={openVscodeEntry}
                onOpenTerminalPath={openTerminalPath}
                onOpenVscodePath={openVscodePath}
              />
            )}
            {page === "forwarding" && (
              <PortForwardingPage
                language={language}
                hosts={hosts}
                expandedIds={forwardingExpandedIds}
                onToggle={toggleForwardingExpand}
                onTogglePin={toggleHostPin}
                onNewForward={(host) => setForwardDialog({ hostId: host.id, draft: newForward() })}
                onDisconnectHost={disconnectHost}
                onConnectForward={connectForward}
                onDisconnectForward={disconnectForward}
                onOpenForwardWeb={(_host, forward) => openForwardWeb(forward)}
                onEditForward={(host, forward) => setForwardDialog({ hostId: host.id, draft: forward })}
                onDeleteForward={deleteForward}
              />
            )}
            {page === "logs" && <LogsPage language={language} logs={logs} />}
            {page === "settings" && (
              <SettingsPage
                settings={settings}
                setSettings={updateSettings}
                appVersion={appVersion}
                update={update}
                onCheckUpdate={checkForUpdate}
                onInstallUpdate={() => installUpdate(settings.updateChannel)}
              />
            )}
            {page === "guide" && <GuidePage language={language} />}
          </div>
        </section>
      </div>

      <AppDialogs {...dialogProps} />
    </main>
  );
}
