import {
  Code2,
  Ellipsis,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Pencil,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { RemoteDirectoryPicker } from "../files/RemoteDirectoryPicker";
import { ft } from "../files/i18n";
import { HistoryPath } from "../components/HistoryPath";
import { HostCardHeader } from "../components/HostCardHeader";
import { SortableHostList, type RenderHostCard } from "../components/SortableHostList";
import { HostTransferActions } from "../components/HostTransferActions";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { PageHeader } from "../components/PageHeader";
import { Input } from "../components/ui/input";
import { t } from "../i18n";
import type { HistoryEntry, Host, Language } from "../types";

function formatOpenedAt(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function RemoteHostMenu(props: {
  language: Language;
  loading: boolean;
  onCheckFingerprint: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const lang = props.language;
  const popupId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const actions = [
    { label: t(lang, "checkHostFingerprint"), icon: ShieldCheck, accent: true, onClick: props.onCheckFingerprint },
    { label: t(lang, "refreshHistory"), icon: RefreshCw, disabled: props.loading, onClick: props.onRefresh },
    { label: t(lang, "editHost"), icon: Pencil, onClick: props.onEdit },
    { label: t(lang, "deleteHost"), icon: Trash2, danger: true, onClick: props.onDelete },
  ];

  return (
    <div
      ref={root}
      className="relative ml-auto"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        trigger.current?.focus();
        setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={t(lang, "moreHostActions")}
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        title={t(lang, "moreHostActions")}
        onClick={() => setOpen(!open)}
        className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-900 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 aria-expanded:bg-blue-100 aria-expanded:text-blue-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:aria-expanded:bg-blue-950 dark:aria-expanded:text-blue-300"
      >
        <Ellipsis size={20} />
      </button>
      {open && (
        <div id={popupId} className="absolute right-0 top-full z-20 mt-2 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-float dark:border-slate-800 dark:bg-slate-950">
          {actions.map(({ label, icon: Icon, accent, danger, disabled, onClick }) => (
            <div key={label} className={danger ? "mt-1 border-t border-slate-200 pt-1 dark:border-slate-800" : undefined}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  trigger.current?.focus();
                  setOpen(false);
                  onClick();
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none disabled:opacity-50 dark:hover:bg-slate-900 dark:focus-visible:bg-slate-900 ${danger ? "text-rose-700 dark:text-rose-300" : "text-slate-700 dark:text-slate-200"}`}
              >
                <Icon size={16} className={accent ? "text-blue-600 dark:text-blue-300" : danger ? undefined : "text-slate-500 dark:text-slate-400"} />
                {label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RemoteHostCard(props: {
  language: Language;
  host: Host;
  dragHandle?: ReactNode;
  entries: HistoryEntry[];
  expanded: boolean;
  compact: boolean;
  renderCard: RenderHostCard;
  loading: boolean;
  onToggle: () => void;
  onTogglePin: () => void;
  onEditHost: () => void;
  onDeleteHost: () => void;
  onRefresh: () => void;
  onSendCommand: () => void;
  onUploadKey: () => void;
  onCheckFingerprint: () => void;
  onOpenTerminalEntry: (entry: HistoryEntry) => void;
  onOpenVscodeEntry: (entry: HistoryEntry) => void;
  onOpenTerminalPath: (path: string) => void;
  onOpenVscodePath: (path: string) => void;
}) {
  const lang = props.language;
  const pathInputId = useId();
  const [customPath, setCustomPath] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const path = customPath.trim();
  const header = (
      <HostCardHeader
        language={lang}
        host={props.host}
        expanded={props.expanded}
        compact={props.compact}
        dragHandle={props.dragHandle}
        accentClassName="bg-violet-600/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
        summary={
          !props.compact && (
            <span>
              {props.loading
                ? t(lang, "loading")
                : `${props.entries.length} ${t(lang, "remotePathsCount")}`}
            </span>
          )
        }
        onToggle={props.onToggle}
        onTogglePin={props.onTogglePin}
      />
  );

  const details = props.expanded && (
        <div className="host-detail-content flex min-w-0 flex-1 flex-col gap-4 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
            <div className="flex max-w-full flex-wrap gap-2">
              <Button variant="secondary" onClick={props.onSendCommand}>
                <Zap size={15} />
                {t(lang, "sendCommand")}
              </Button>
              <Button variant="secondary" onClick={props.onUploadKey}>
                <KeyRound size={15} />
                {t(lang, "uploadKey")}
              </Button>
            </div>
            <RemoteHostMenu
              language={lang}
              loading={props.loading}
              onCheckFingerprint={props.onCheckFingerprint}
              onRefresh={props.onRefresh}
              onEdit={props.onEditHost}
              onDelete={props.onDeleteHost}
            />
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
            <div className="grid max-h-64 min-w-0 auto-rows-max grid-cols-1 gap-1 overflow-x-hidden overflow-y-auto rounded-xl border border-slate-100 p-1 dark:border-slate-800">
              {props.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex min-w-0 items-center rounded-lg text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <button
                    onClick={() => props.onOpenTerminalEntry(entry)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                  >
                    <FolderOpen
                      size={16}
                      className="shrink-0 text-violet-500"
                    />
                    <span className="min-w-0 flex-1">
                      <HistoryPath path={entry.label} />
                      <span className="block text-xs text-slate-400">
                        {formatOpenedAt(entry.openedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => props.onOpenVscodeEntry(entry)}
                    className="mr-1 shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800"
                    title={t(lang, "openInVscode")}
                  >
                    <Code2 size={15} />
                  </button>
                  <button
                    onClick={() => setCustomPath(entry.label)}
                    className="mr-1 shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800"
                    title={t(lang, "vscodeFillPath")}
                  >
                    <PenLine size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto grid min-w-0 grid-cols-1 gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <label htmlFor={pathInputId} className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t(lang, "remoteOpenPathLabel")}
            </label>
            <div className="flex flex-wrap gap-2">
              <div className="flex min-w-0 flex-[1_1_23rem] flex-wrap gap-2">
                <Input
                  id={pathInputId}
                  className="min-w-0 flex-[1_1_10rem]"
                  value={customPath}
                  title={customPath || undefined}
                  placeholder={t(lang, "remoteOpenPathPlaceholder")}
                  onChange={(event) => setCustomPath(event.target.value)}
                />
                <Button variant="secondary" className="ml-auto whitespace-nowrap" onClick={() => setPickerOpen(true)}>
                  <FolderOpen size={16} />
                  {ft(lang, "chooseDirectory")}
                </Button>
              </div>
              <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2 whitespace-nowrap">
                <Button variant="secondary" onClick={() => props.onOpenTerminalPath(path)}>
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
        </div>
  );

  return (
    <>
      {props.renderCard(header, details)}
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
    </>
  );
}

export function RemoteConnectionsPage(props: {
  language: Language;
  hosts: Host[];
  autoSortHosts: boolean;
  twoColumnHosts: boolean;
  onMoveHost: (id: string, targetId: string) => Promise<boolean>;
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
  onCheckFingerprint: (host: Host) => void;
  onOpenTerminalEntry: (host: Host, entry: HistoryEntry) => void;
  onOpenVscodeEntry: (host: Host, entry: HistoryEntry) => void;
  onOpenTerminalPath: (host: Host, path: string) => void;
  onOpenVscodePath: (host: Host, path: string) => void;
}) {
  const lang = props.language;
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        page="remote"
        actions={
          <HostTransferActions
            language={lang}
            onNewHost={props.onNewHost}
            onImportFromFile={props.onImportFromFile}
            onImportFromConfig={props.onImportFromConfig}
            onExportToFile={props.onExportToFile}
            onExportToConfig={props.onExportToConfig}
          />
        }
      >
        {t(lang, "remoteConnectionsTitle")}
      </PageHeader>
      {props.hosts.length === 0 ? (
        <Card className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {t(lang, "noHosts")}
        </Card>
      ) : (
        <SortableHostList
          hosts={props.hosts}
          language={lang}
          autoSort={props.autoSortHosts}
          twoColumn={props.twoColumnHosts}
          expandedIds={props.expandedIds}
          onMove={props.onMoveHost}
        >
          {(host, renderCard, dragHandle) => (
            <RemoteHostCard
              language={lang}
              host={host}
              dragHandle={dragHandle}
              compact={props.twoColumnHosts}
              renderCard={renderCard}
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
              onCheckFingerprint={() => props.onCheckFingerprint(host)}
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
          )}
        </SortableHostList>
      )}
    </div>
  );
}
