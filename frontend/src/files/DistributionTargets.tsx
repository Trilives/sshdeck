import { useEffect, useState } from "react";
import {
  ChevronDown,
  Laptop,
  LoaderCircle,
  Search,
  Server,
} from "lucide-react";
import type { Host, Language } from "../types";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { FilePane } from "./FilePane";
import { ft } from "./i18n";
import { useFileBrowser } from "./useFileBrowser";

export interface Recipient {
  hostId: string;
  sessionId: string;
  path: string;
  busy: boolean;
  error: string;
}
export interface PathCommand {
  path: string;
  version: number;
}
function RecipientBrowser({
  hostId,
  hosts,
  language: lang,
  onChange,
  visible,
  command,
  refreshVersion,
}: {
  hostId: string;
  hosts: Host[];
  language: Language;
  onChange: (id: string, recipient: Recipient | null) => void;
  visible: boolean;
  command: PathCommand | null;
  refreshVersion: number;
}) {
  const b = useFileBrowser(hostId, true);
  const sid = b.listing?.sessionId || "";
  const path = b.listing?.path || "";
  useEffect(() => {
    onChange(hostId, {
      hostId,
      sessionId: sid,
      path,
      busy: b.busy,
      error: b.error,
    });
  }, [hostId, sid, path, b.busy, b.error, onChange]);
  useEffect(() => () => onChange(hostId, null), [hostId, onChange]);
  useEffect(() => {
    if (command && sid) void b.navigate(command.path);
  }, [command, sid, b.navigate]);
  const refresh = b.refresh;
  useEffect(() => {
    if (refreshVersion) refresh();
  }, [refreshVersion, refresh]);
  return (
    <div className={cn("min-h-0 flex-1", !visible && "hidden")}>
      <FilePane hosts={hosts} language={lang} hostId={hostId} browser={b} />
    </div>
  );
}

export function DistributionTargets({
  hosts,
  language: lang,
  selected,
  onToggle,
  recipients,
  onChange,
  command,
  onApply,
  refreshVersion,
}: {
  hosts: Host[];
  language: Language;
  selected: string[];
  onToggle: (id: string) => void;
  recipients: Record<string, Recipient>;
  onChange: (id: string, r: Recipient | null) => void;
  command: PathCommand | null;
  onApply: (path: string) => void;
  refreshVersion: number;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [open, setOpen] = useState(false);
  const activeId =
    active !== null && selected.includes(active)
      ? active
      : (selected[0] ?? null);
  const choices = [
    { id: "", name: ft(lang, "local"), sshHost: "Windows" },
    ...hosts,
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative shrink-0 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/80">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-blue-50 px-2 py-2 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"
          >
            {ft(lang, "recipients")}{" "}
            <span className="text-[10px]">{selected.length}</span>
            <ChevronDown size={12} />
          </button>
          {selected.length > 0 && (
            <select
              aria-label={ft(lang, "browse")}
              value={activeId ?? ""}
              onChange={(e) => setActive(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-lg bg-slate-50 px-2 text-xs dark:bg-slate-900"
            >
              {selected.map((id) => (
                <option key={id || "local"} value={id}>
                  {id
                    ? hosts.find((h) => h.id === id)?.name ||
                      hosts.find((h) => h.id === id)?.sshHost
                    : ft(lang, "local")}
                </option>
              ))}
            </select>
          )}
        </div>
        {open && (
          <>
            <button
              className="fixed inset-0 z-30 cursor-default"
              aria-label={ft(lang, "close")}
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-x-0 top-12 z-40 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-2 text-slate-400 dark:bg-slate-800">
                <Search size={12} />
                <input
                  autoFocus
                  className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
                  placeholder={ft(lang, "searchHost")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-auto">
                {choices
                  .filter((h) =>
                    `${h.name} ${h.sshHost}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((h) => {
                    const checked = selected.includes(h.id);
                    const r = recipients[h.id];
                    return (
                      <div
                        key={h.id || "local"}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-2 py-1.5",
                          checked && activeId === h.id
                            ? "bg-blue-50 dark:bg-blue-500/10"
                            : "hover:bg-slate-50 dark:hover:bg-slate-900",
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={h.name || h.sshHost}
                          checked={checked}
                          onChange={() => {
                            onToggle(h.id);
                            if (!checked) setActive(h.id);
                          }}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
                          disabled={!checked}
                          onClick={() => {
                            setActive(h.id);
                            setOpen(false);
                          }}
                        >
                          {h.id ? (
                            <Server
                              size={13}
                              className="shrink-0 text-violet-400"
                            />
                          ) : (
                            <Laptop
                              size={13}
                              className="shrink-0 text-blue-400"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">
                              {h.name || h.sshHost}
                            </span>
                            <span className="block truncate text-[10px] text-slate-400">
                              {r?.path || h.sshHost}
                            </span>
                          </span>
                          {checked &&
                            (r?.busy ? (
                              <LoaderCircle
                                size={12}
                                className="shrink-0 animate-spin text-amber-400"
                              />
                            ) : (
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  r?.sessionId
                                    ? "bg-emerald-500"
                                    : r?.error
                                      ? "bg-rose-400"
                                      : "bg-slate-300",
                                )}
                              />
                            ))}
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>
        )}
        <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <input
            className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-blue-400 dark:border-slate-700"
            placeholder={ft(lang, "sharedPath")}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && path.trim()) onApply(path.trim());
            }}
          />
          <Button
            variant="secondary"
            className="h-8 px-2 text-[10px]"
            disabled={!selected.length || !path.trim()}
            onClick={() => onApply(path.trim())}
          >
            {ft(lang, "apply")}
          </Button>
        </div>
      </div>
      {selected.map((id) => (
        <RecipientBrowser
          key={id || "local"}
          hostId={id}
          hosts={hosts}
          language={lang}
          onChange={onChange}
          visible={activeId === id}
          command={command}
          refreshVersion={refreshVersion}
        />
      ))}
      {!selected.length && (
        <div className="flex min-h-28 flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-200 p-5 text-center text-xs leading-6 text-slate-400 dark:border-slate-800">
          {ft(lang, "recipientsHint")}
        </div>
      )}
    </div>
  );
}
