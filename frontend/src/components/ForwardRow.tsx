import { Globe, Pencil, Plug, PlugZap, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { StatusBadge } from "./StatusBadge";
import { t } from "../i18n";
import type { Forward, Language } from "../types";

export function ForwardRow(props: {
  language: Language;
  forward: Forward;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenWeb: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const lang = props.language;
  const running = props.forward.status === "running";
  const route = `${props.forward.bindDisplay} → ${props.forward.targetDisplay}`;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="min-w-0 flex-[1_1_8rem]">
        <div title={props.forward.name} className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{props.forward.name}</div>
        <div title={route} className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
          <span className="uppercase">{props.forward.mode}</span>
          {" · "}
          {route}
        </div>
      </div>
      <StatusBadge language={lang} status={props.forward.status} />
      <div className="forward-rule-actions flex max-w-full flex-wrap gap-2 whitespace-nowrap">
        {running && (
          <Button variant="ghost" onClick={props.onOpenWeb} aria-label={t(lang, "openWeb")} title={t(lang, "openWeb")}>
            <Globe size={15} />
          </Button>
        )}
        {running ? (
          <Button variant="ghost" onClick={props.onDisconnect}>
            <PlugZap size={15} />
            {t(lang, "disconnect")}
          </Button>
        ) : (
          <Button variant="ghost" onClick={props.onConnect}>
            <Plug size={15} />
            {t(lang, "connect")}
          </Button>
        )}
        <Button variant="ghost" onClick={props.onEdit}>
          <Pencil size={15} />
          {t(lang, "edit")}
        </Button>
        <Button variant="danger" onClick={props.onDelete} aria-label={t(lang, "delete")}>
          <Trash2 size={15} />
        </Button>
      </div>
    </div>
  );
}
