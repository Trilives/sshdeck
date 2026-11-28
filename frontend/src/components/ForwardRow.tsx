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
    <div className="forward-rule flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="forward-rule-info min-w-0 flex-[1_1_8rem]">
        <div title={props.forward.name} className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{props.forward.name}</div>
        <div title={route} className="forward-rule-route mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
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
          <Button variant="ghost" onClick={props.onDisconnect} aria-label={t(lang, "disconnect")} title={t(lang, "disconnect")}>
            <PlugZap size={15} />
            <span className="forward-action-text">{t(lang, "disconnect")}</span>
          </Button>
        ) : (
          <Button variant="ghost" onClick={props.onConnect} aria-label={t(lang, "connect")} title={t(lang, "connect")}>
            <Plug size={15} />
            <span className="forward-action-text">{t(lang, "connect")}</span>
          </Button>
        )}
        <Button variant="ghost" onClick={props.onEdit} aria-label={t(lang, "edit")} title={t(lang, "edit")}>
          <Pencil size={15} />
          <span className="forward-action-text">{t(lang, "edit")}</span>
        </Button>
        <Button variant="danger" onClick={props.onDelete} aria-label={t(lang, "delete")} title={t(lang, "delete")}>
          <Trash2 size={15} />
        </Button>
      </div>
    </div>
  );
}
