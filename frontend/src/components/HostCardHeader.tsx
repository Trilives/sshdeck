import { ChevronDown, ChevronRight, Pin, PinOff, Server } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../i18n";
import type { Host, Language } from "../types";
import { Button } from "./ui/button";

export function HostCardHeader(props: {
  language: Language;
  host: Host;
  expanded: boolean;
  accentClassName: string;
  summary: ReactNode;
  dragHandle?: ReactNode;
  onToggle: () => void;
  onTogglePin: () => void;
}) {
  const lang = props.language;
  const endpoint = `${props.host.sshUser ? `${props.host.sshUser}@` : ""}${props.host.sshHost || "?"}:${props.host.sshPort || "22"}`;

  return (
    <div className="flex w-full items-center gap-2 pr-4 transition hover:bg-slate-50 dark:hover:bg-slate-900">
      <button onClick={props.onToggle} className="flex min-w-0 flex-1 items-center gap-3 px-5 py-4 text-left">
        {props.expanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${props.accentClassName}`}>
          <Server size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{props.host.name}</span>
            {props.host.pinned && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <Pin size={11} className="fill-current" />
                {t(lang, "pinned")}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">{endpoint}</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">{props.summary}</div>
      </button>
      <Button
        variant="ghost"
        onClick={props.onTogglePin}
        aria-label={t(lang, props.host.pinned ? "unpin" : "pin")}
        title={t(lang, props.host.pinned ? "unpin" : "pin")}
      >
        {props.host.pinned ? (
          <PinOff size={15} className="text-slate-400" />
        ) : (
          <Pin size={15} className="text-blue-600 dark:text-blue-300" />
        )}
      </Button>
      {props.dragHandle}
    </div>
  );
}
