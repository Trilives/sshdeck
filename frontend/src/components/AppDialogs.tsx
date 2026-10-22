import type { Dispatch, SetStateAction } from "react";
import { t } from "../i18n";
import type { CriticalErrorPayload, Forward, HistoryEntry, Host, Language } from "../types";
import {
  CloseBehaviorDialog,
  ConfirmDialog,
  ConnectionErrorDialog,
  CriticalErrorDialog,
  ForwardDialog,
  HostDialog,
  HostKeyChangedDialog,
  ImportConflictDialog,
  InputPasswordDialog,
  KeyUploadDialog,
  PasswordDialog,
  SelectHostsDialog,
  SendCommandDialog,
  SshMissingDialog,
  VscodeMissingDialog,
} from "./dialogs";
import { RemoteConnectionDialog } from "./dialogs/remote";

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface AppDialogsProps {
  language: Language;
  hostDialog: Host | null;
  setHostDialog: Setter<Host | null>;
  saveHost: () => void;
  forwardDialog: { hostId: string; draft: Forward } | null;
  setForwardDialog: Setter<{ hostId: string; draft: Forward } | null>;
  saveForward: () => void;
  sendCmd: { hostId: string; hostName: string } | null;
  command: string;
  setCommand: Setter<string>;
  commandOutput: string;
  commandBusy: boolean;
  closeSendCommand: () => void;
  runSendCommand: () => void;
  cancelSendCommand: () => void;
  sendCmdPwOpen: boolean;
  setSendCmdPwOpen: Setter<boolean>;
  sendCmdPwValue: string;
  setSendCmdPwValue: Setter<string>;
  runSendCommandWithPassword: () => void;
  passwordTarget: { host: Host; forward: Forward } | null;
  setPasswordTarget: Setter<{ host: Host; forward: Forward } | null>;
  passwordValue: string;
  setPasswordValue: Setter<string>;
  connectWithPassword: () => void;
  keyUploadTarget: Host | null;
  setKeyUploadTarget: Setter<Host | null>;
  keyUploadPassword: string;
  setKeyUploadPassword: Setter<string>;
  uploadKeyWithPassword: () => void;
  hostKeyTarget: { host: Host; forward?: Forward; action: "connect" | "upload" } | null;
  setHostKeyTarget: Setter<{ host: Host; forward?: Forward; action: "connect" | "upload" } | null>;
  hostKeyFingerprint: string;
  hostKeyFetching: boolean;
  trustHostKeyAndRetry: () => void;
  criticalError: CriticalErrorPayload | null;
  setCriticalError: Setter<CriticalErrorPayload | null>;
  connectError: string | null;
  setConnectError: Setter<string | null>;
  selectHosts: { mode: "import" | "export-file" | "export-config"; items: Host[]; selected: Set<string> } | null;
  setSelectHosts: Setter<{ mode: "import" | "export-file" | "export-config"; items: Host[]; selected: Set<string> } | null>;
  toggleSelectHost: (id: string) => void;
  confirmSelectHosts: () => void;
  importConflict: { duplicates: string[]; hosts: Host[]; mode: "import" | "export-config" } | null;
  setImportConflict: Setter<{ duplicates: string[]; hosts: Host[]; mode: "import" | "export-config" } | null>;
  applyImportStrategy: (strategy: "overwrite" | "skip") => void;
  deleteHostTarget: Host | null;
  setDeleteHostTarget: Setter<Host | null>;
  confirmDeleteHost: () => void;
  sshMissing: boolean;
  setSshMissing: Setter<boolean>;
  installSsh: () => void;
  historyDialog: { host: Host; entries: HistoryEntry[] } | null;
  setHistoryDialog: Setter<{ host: Host; entries: HistoryEntry[] } | null>;
  openTerminalPath: (host: Host, path: string) => void;
  openVscodeEntry: (host: Host, entry: HistoryEntry) => void;
  openVscodePath: (host: Host, path: string) => void;
  vscodeMissing: "vscode" | "remoteSsh" | null;
  setVscodeMissing: Setter<"vscode" | "remoteSsh" | null>;
  closePrompt: { active: boolean } | null;
  setClosePrompt: Setter<{ active: boolean } | null>;
  minimizeToTray: (remember: boolean) => void;
  exitApp: (remember: boolean) => void;
}

export function AppDialogs(props: AppDialogsProps) {
  const lang = props.language;
  return (
    <>
      {props.hostDialog && <HostDialog language={lang} draft={props.hostDialog} setDraft={props.setHostDialog} onClose={() => props.setHostDialog(null)} onSave={props.saveHost} />}
      {props.forwardDialog && (
        <ForwardDialog language={lang} draft={props.forwardDialog.draft} setDraft={(draft) => props.setForwardDialog({ ...props.forwardDialog!, draft })} onClose={() => props.setForwardDialog(null)} onSave={props.saveForward} />
      )}
      {props.sendCmd && (
        <SendCommandDialog
          language={lang}
          hostName={props.sendCmd.hostName}
          command={props.command}
          setCommand={props.setCommand}
          output={props.commandOutput}
          busy={props.commandBusy}
          onClose={props.closeSendCommand}
          onRun={props.runSendCommand}
          onCancel={props.cancelSendCommand}
          onRunWithPassword={() => { props.setSendCmdPwValue(""); props.setSendCmdPwOpen(true); }}
        />
      )}
      {props.sendCmd && props.sendCmdPwOpen && (
        <InputPasswordDialog
          language={lang}
          title={t(lang, "sendWithPassword")}
          description={props.sendCmd.hostName}
          submitLabel={t(lang, "run")}
          password={props.sendCmdPwValue}
          setPassword={props.setSendCmdPwValue}
          onCancel={() => { props.setSendCmdPwOpen(false); props.setSendCmdPwValue(""); }}
          onSubmit={props.runSendCommandWithPassword}
        />
      )}
      {props.passwordTarget && (
        <PasswordDialog language={lang} targetName={`${props.passwordTarget.host.name} / ${props.passwordTarget.forward.name}`} password={props.passwordValue} setPassword={props.setPasswordValue} onCancel={() => { props.setPasswordTarget(null); props.setPasswordValue(""); }} onSubmit={props.connectWithPassword} />
      )}
      {props.keyUploadTarget && (
        <KeyUploadDialog language={lang} hostName={props.keyUploadTarget.name} password={props.keyUploadPassword} setPassword={props.setKeyUploadPassword} onCancel={() => { props.setKeyUploadTarget(null); props.setKeyUploadPassword(""); }} onSubmit={props.uploadKeyWithPassword} />
      )}
      {props.hostKeyTarget && (
        <HostKeyChangedDialog language={lang} hostName={props.hostKeyTarget.host.name} fingerprint={props.hostKeyFingerprint} fetching={props.hostKeyFetching} onCancel={() => props.setHostKeyTarget(null)} onTrust={props.trustHostKeyAndRetry} />
      )}
      {props.criticalError && <CriticalErrorDialog language={lang} error={props.criticalError} onClose={() => props.setCriticalError(null)} />}
      {props.connectError && <ConnectionErrorDialog language={lang} message={props.connectError} onClose={() => props.setConnectError(null)} />}
      {props.selectHosts && (
        <SelectHostsDialog
          language={lang}
          title={t(lang, props.selectHosts.mode === "import" ? "selectHostsToImport" : "selectHostsToExport")}
          confirmLabel={t(lang, props.selectHosts.mode === "import" ? "confirmImport" : "confirmExport")}
          items={props.selectHosts.items.map((host) => ({ id: host.id, name: host.name, sshHost: host.sshHost }))}
          selected={props.selectHosts.selected}
          onToggle={props.toggleSelectHost}
          onSelectAll={() => props.setSelectHosts((prev) => prev ? { ...prev, selected: new Set(prev.items.map((host) => host.id)) } : prev)}
          onClearAll={() => props.setSelectHosts((prev) => prev ? { ...prev, selected: new Set() } : prev)}
          onCancel={() => props.setSelectHosts(null)}
          onConfirm={props.confirmSelectHosts}
        />
      )}
      {props.importConflict && (
        <ImportConflictDialog language={lang} duplicates={props.importConflict.duplicates} description={props.importConflict.mode === "export-config" ? t(lang, "exportConfigConflictDesc") : undefined} onCancel={() => props.setImportConflict(null)} onOverwrite={() => props.applyImportStrategy("overwrite")} onSkip={() => props.applyImportStrategy("skip")} />
      )}
      {props.deleteHostTarget && (
        <ConfirmDialog language={lang} title={t(lang, "confirmDeleteHostTitle")} description={`${props.deleteHostTarget.name} — ${t(lang, "confirmDeleteHostDesc")}`} confirmLabel={t(lang, "delete")} onCancel={() => props.setDeleteHostTarget(null)} onConfirm={props.confirmDeleteHost} />
      )}
      {props.sshMissing && <SshMissingDialog language={lang} onCancel={() => props.setSshMissing(false)} onInstall={props.installSsh} />}
      {props.historyDialog && (
        <RemoteConnectionDialog
          language={lang}
          hostName={props.historyDialog.host.name}
          entries={props.historyDialog.entries}
          onOpenTerminalEntry={(entry) => props.openTerminalPath(props.historyDialog!.host, entry.label)}
          onOpenVscodeEntry={(entry) => props.openVscodeEntry(props.historyDialog!.host, entry)}
          onOpenTerminalPath={(path) => props.openTerminalPath(props.historyDialog!.host, path)}
          onOpenVscodePath={(path) => props.openVscodePath(props.historyDialog!.host, path)}
          onCancel={() => props.setHistoryDialog(null)}
        />
      )}
      {props.vscodeMissing && <VscodeMissingDialog language={lang} kind={props.vscodeMissing} onClose={() => props.setVscodeMissing(null)} />}
      {props.closePrompt && <CloseBehaviorDialog language={lang} active={props.closePrompt.active} onMinimize={props.minimizeToTray} onExit={props.exitApp} onCancel={() => props.setClosePrompt(null)} />}
    </>
  );
}
