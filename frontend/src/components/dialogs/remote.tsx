import { ModalOverlay } from "../ui/ModalOverlay";
import { useEffect, useId, useState } from "react";
import { Code2, FolderOpen, PenLine, Terminal, X } from "lucide-react";
import { t } from "../../i18n";
import type { HistoryEntry, Language } from "../../types";
import { HistoryPath } from "../HistoryPath";
import { Button } from "../ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";

function formatOpenedAt(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function RemoteConnectionDialog(props: {
  language: Language;
  hostName: string;
  entries: HistoryEntry[];
  onOpenTerminalEntry: (entry: HistoryEntry) => void;
  onOpenVscodeEntry: (entry: HistoryEntry) => void;
  onOpenTerminalPath: (path: string) => void;
  onOpenVscodePath: (path: string) => void;
  onCancel: () => void;
}) {
  const lang = props.language;
  const titleId = useId();
  const title = t(lang, "historyTitle") + " — " + props.hostName;
  const rowActionClass = "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800";
  const [customPath, setCustomPath] = useState("");
  const path = customPath.trim();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") props.onOpenTerminalPath(path);
      else if (event.key === "Escape") props.onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, props]);

  return (
    <ModalOverlay className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full min-w-0 max-w-lg flex-col !overflow-hidden border-blue-200 bg-white dark:border-blue-900 dark:bg-slate-950"
      >
        <CardHeader className="flex shrink-0 flex-row items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <CardTitle id={titleId} className="truncate" title={title}>{title}</CardTitle>
            <CardDescription className="mt-1">{t(lang, "historyDesc")}</CardDescription>
          </div>
          <button onClick={props.onCancel} className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t(lang, "close")}>
            <X size={18} />
          </button>
        </CardHeader>
        <div className="grid max-h-80 min-h-0 grid-cols-1 gap-1 overflow-y-auto overscroll-contain">
          {props.entries.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-sm leading-6 text-slate-500 dark:border-slate-800 dark:text-slate-400">{t(lang, "historyEmpty")}</p>
          )}
          {props.entries.map((entry) => (
            <div key={entry.id} className="flex items-center rounded-xl pr-1 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">
              <button onClick={() => props.onOpenTerminalEntry(entry)} title={`${t(lang, "openInTerminal")} — ${entry.label}`} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left">
                <FolderOpen size={16} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <HistoryPath path={entry.label} />
                  <span className="block text-xs text-slate-400 dark:text-slate-500">{formatOpenedAt(entry.openedAt)}</span>
                </span>
              </button>
              <button type="button" onClick={() => props.onOpenVscodeEntry(entry)} title={t(lang, "openInVscode")} aria-label={t(lang, "openInVscode")} className={rowActionClass}>
                <Code2 size={15} aria-hidden />
              </button>
              <button type="button" onClick={() => setCustomPath(entry.label)} title={t(lang, "vscodeFillPath")} aria-label={t(lang, "vscodeFillPath")} className={rowActionClass}>
                <PenLine size={15} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 shrink-0 border-t border-slate-200 pt-4 dark:border-slate-800">
          <label className="mb-2 block text-xs font-medium text-slate-500 dark:text-slate-400">{t(lang, "remoteOpenPathLabel")}</label>
          <Input value={customPath} placeholder={t(lang, "remoteOpenPathPlaceholder")} onChange={(event) => setCustomPath(event.target.value)} autoFocus />
        </div>
        <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-3">
          <Button variant="secondary" className="min-w-[7.5rem]" onClick={() => props.onOpenTerminalPath(path)}><Terminal size={16} />{t(lang, "remoteOpenTerminal")}</Button>
          <Button className="min-w-[7.5rem]" onClick={() => props.onOpenVscodePath(path)}><Code2 size={16} />{t(lang, "remoteOpenVscode")}</Button>
          <Button variant="secondary" onClick={props.onCancel}>{t(lang, "cancel")}</Button>
        </div>
      </Card>
    </ModalOverlay>
  );
}
