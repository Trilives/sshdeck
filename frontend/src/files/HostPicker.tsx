import { useState } from "react";
import { Check, ChevronDown, Laptop, Search, Server } from "lucide-react";
import type { Host, Language } from "../types";
import { ft } from "./i18n";
import { cn } from "../lib/utils";

export function HostPicker({
  hosts,
  value,
  onChange,
  language,
  disabled,
}: {
  hosts: Host[];
  value: string;
  onChange: (id: string) => void;
  language: Language;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const host = hosts.find((h) => h.id === value);
  const label = value
    ? host?.name || host?.sshHost || ft(language, "chooseHost")
    : ft(language, "local");
  const choices = hosts.filter((h) =>
    `${h.name} ${h.sshHost} ${h.sshUser}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
        aria-expanded={open}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            value
              ? "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
              : "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
          )}
        >
          {value ? <Server size={17} /> : <Laptop size={17} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{label}</span>
          <span className="block truncate text-[11px] text-slate-400">
            {host
              ? `${host.sshUser ? `${host.sshUser}@` : ""}${host.sshHost}:${host.sshPort}`
              : "Windows"}
          </span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <button
            aria-label={ft(language, "close")}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-40 mt-2 w-full min-w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-100 px-2 dark:bg-slate-800">
              <Search size={14} className="text-slate-400" />
              <input
                autoFocus
                className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"
                placeholder={ft(language, "searchHost")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                }}
              />
            </div>
            <div className="max-h-64 overflow-auto">
              {(!query ||
                ft(language, "local")
                  .toLowerCase()
                  .includes(query.toLowerCase())) && (
                <button
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Laptop size={15} />
                  <span className="flex-1">{ft(language, "local")}</span>
                  {!value && <Check size={14} className="text-blue-500" />}
                </button>
              )}
              {choices.map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    onChange(h.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Server size={15} className="shrink-0 text-violet-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {h.name || h.sshHost}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {h.sshHost}
                    </span>
                  </span>
                  {h.id === value && (
                    <Check size={14} className="text-blue-500" />
                  )}
                </button>
              ))}
              {!hosts.length && (
                <p className="p-2 text-xs text-slate-400">
                  {ft(language, "noHost")}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
