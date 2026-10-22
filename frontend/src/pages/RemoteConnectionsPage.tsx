import {
  Code2,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Pencil,
  PenLine,
  RefreshCw,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useState } from "react";
import { RemoteDirectoryPicker } from "../files/RemoteDirectoryPicker";
import { ft } from "../files/i18n";
import { HostCardHeader } from "../components/HostCardHeader";
import { HostTransferActions } from "../components/HostTransferActions";
import { Button } from "../components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { t } from "../i18n";
import type { HistoryEntry, Host, Language } from "../types";

function formatOpenedAt(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function RemoteHostCard(props: {
  language: Language;
  host: Host;
  entries: HistoryEntry[];
  expanded: boolean;
  loading: boolean;
  onToggle: () => void;
  onTogglePin: () => void;
  onEditHost: () => void;
  onDeleteHost: () => void;
  onRefresh: () => void;
  onSendCommand: () => void;
  onUploadKey: () => void;
  onOpenTerminalEntry: (entry: HistoryEntry) => void;
  onOpenVscodeEntry: (entry: HistoryEntry) => void;
  onOpenTerminalPath: (path: string) => void;
  onOpenVscodePath: (path: string) => void;
}) {
  const lang = props.language;
  const [customPath, setCustomPath] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const path = customPath.trim();
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950/70">
      <HostCardHeader
        language={lang}
        host={props.host}
        expanded={props.expanded}
        accentClassName="bg-violet-600/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
        summary={
          <span>
            {props.loading
              ? t(lang, "loading")
              : `${props.entries.length} ${t(lang, "remotePathsCount")}`}
          </span>
        }
        onToggle={props.onToggle}
        onTogglePin={props.onTogglePin}
      />

      {props.expanded && (
        <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={props.onSendCommand}>
              <Zap size={15} />
              {t(lang, "sendCommand")}
            </Button>
            <Button variant="secondary" onClick={props.onUploadKey}>
              <KeyRound size={15} />
              {t(lang, "uploadKey")}
            </Button>
            <Button
              variant="secondary"
              onClick={props.onRefresh}
              disabled={props.loading}
            >
              <RefreshCw
                size={15}
                className={props.loading ? "animate-spin" : ""}
              />
              {t(lang, "refreshHistory")}
            </Button>
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={props.onEditHost}
            >
              <Pencil size={15} />
              {t(lang, "editHost")}
            </Button>
            <Button variant="danger" onClick={props.onDeleteHost}>
              <Trash2 size={15} />
              {t(lang, "deleteHost")}
            </Button>
          </div>

          {props.loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <LoaderCircle size={16} className="animate-spin" />
              {t(lang, "loadingHistory")}
            </div>
          ) : props.entries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
              {t(lang, "historyEmpty")}
            </p>
          ) : (
            <div className="grid max-h-64 gap-1 overflow-auto rounded-xl border border-slate-100 p-1 dark:border-slate-800">
              {props.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center rounded-lg text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <button
                    onClick={() => props.onOpenTerminalEntry(entry)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                  >
                    <FolderOpen
                      size={16}
                      className="shrink-0 text-violet-500"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="block truncate">{entry.label}</span>
                      <span className="block text-xs text-slate-400">
                        {formatOpenedAt(entry.openedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => props.onOpenVscodeEntry(entry)}
                    className="mr-1 rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800"
                    title={t(lang, "openInVscode")}
                  >
                    <Code2 size={15} />
                  </button>
                  <button
                    onClick={() => setCustomPath(entry.label)}
                    className="mr-1 rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800"
                    title={t(lang, "vscodeFillPath")}
                  >
                    <PenLine size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t(lang, "remoteOpenPathLabel")}
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-[16rem] flex-1"
                value={customPath}
                placeholder={t(lang, "remoteOpenPathPlaceholder")}
                onChange={(event) => setCustomPath(event.target.value)}
              />
              <Button variant="secondary" onClick={() => setPickerOpen(true)}>
                <FolderOpen size={16} />
                {ft(lang, "chooseDirectory")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => props.onOpenTerminalPath(path)}
              >
                <Terminal size={16} />
                {t(lang, "remoteOpenTerminal")}
              </Button>
              <Button onClick={() => props.onOpenVscodePath(path)}>
                <Code2 size={16} />
                {t(lang, "remoteOpenVscode")}
              </Button>
            </div>
          </div>
        </div>
      )}
      {pickerOpen && (
        <RemoteDirectoryPicker
          host={props.host}
          language={lang}
          onClose={closePicker}
          onOpenTerminal={(selected) => {
            setCustomPath(selected);
            setPickerOpen(false);
            props.onOpenTerminalPath(selected);
          }}
          onOpenVscode={(selected) => {
            setCustomPath(selected);
            setPickerOpen(false);
            props.onOpenVscodePath(selected);
          }}
          onChoose={(selected) => {
            setCustomPath(selected);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function RemoteConnectionsPage(props: {
  language: Language;
  hosts: Host[];
  histories: Record<string, HistoryEntry[]>;
  expandedIds: Set<string>;
  loadingIds: Set<string>;
  onNewHost: () => void;
  onImportFromFile: () => void;
  onImportFromConfig: () => void;
  onExportToFile: () => void;
  onExportToConfig: () => void;
  onToggle: (host: Host) => void;
  onTogglePin: (host: Host) => void;
  onEditHost: (host: Host) => void;
  onDeleteHost: (host: Host) => void;
  onRefresh: (host: Host) => void;
  onSendCommand: (host: Host) => void;
  onUploadKey: (host: Host) => void;
  onOpenTerminalEntry: (host: Host, entry: HistoryEntry) => void;
  onOpenVscodeEntry: (host: Host, entry: HistoryEntry) => void;
  onOpenTerminalPath: (host: Host, path: string) => void;
  onOpenVscodePath: (host: Host, path: string) => void;
}) {
  const lang = props.language;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[16rem] flex-1 space-y-1">
          <CardTitle>{t(lang, "remoteConnectionsTitle")}</CardTitle>
          <CardDescription>{t(lang, "remoteConnectionsDesc")}</CardDescription>
        </div>
        <HostTransferActions
          language={lang}
          onNewHost={props.onNewHost}
          onImportFromFile={props.onImportFromFile}
          onImportFromConfig={props.onImportFromConfig}
          onExportToFile={props.onExportToFile}
          onExportToConfig={props.onExportToConfig}
        />
      </CardHeader>
      {props.hosts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
          {t(lang, "noHosts")}
        </p>
      ) : (
        <div className="grid gap-3">
          {props.hosts.map((host) => (
            <RemoteHostCard
              key={host.id}
              language={lang}
              host={host}
              entries={props.histories[host.id] ?? []}
              expanded={props.expandedIds.has(host.id)}
              loading={props.loadingIds.has(host.id)}
              onToggle={() => props.onToggle(host)}
              onTogglePin={() => props.onTogglePin(host)}
              onEditHost={() => props.onEditHost(host)}
              onDeleteHost={() => props.onDeleteHost(host)}
              onRefresh={() => props.onRefresh(host)}
              onSendCommand={() => props.onSendCommand(host)}
              onUploadKey={() => props.onUploadKey(host)}
              onOpenTerminalEntry={(entry) =>
                props.onOpenTerminalEntry(host, entry)
              }
              onOpenVscodeEntry={(entry) =>
                props.onOpenVscodeEntry(host, entry)
              }
              onOpenTerminalPath={(path) =>
                props.onOpenTerminalPath(host, path)
              }
              onOpenVscodePath={(path) => props.onOpenVscodePath(host, path)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
