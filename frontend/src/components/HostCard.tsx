import { Plus, Power } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { ForwardRow } from "./ForwardRow";
import { HostCardHeader } from "./HostCardHeader";
import type { RenderHostCard } from "./SortableHostList";
import { cn } from "../lib/utils";
import { t } from "../i18n";
import type { Forward, Host, Language } from "../types";

export function HostCard(props: {
  language: Language;
  host: Host;
  expanded: boolean;
  compact: boolean;
  renderCard: RenderHostCard;
  dragHandle?: ReactNode;
  onToggle: () => void;
  onNewForward: () => void;
  onDisconnectHost: () => void;
  onTogglePin: () => void;
  onConnectForward: (forward: Forward) => void;
  onDisconnectForward: (forward: Forward) => void;
  onOpenForwardWeb: (forward: Forward) => void;
  onEditForward: (forward: Forward) => void;
  onDeleteForward: (forward: Forward) => void;
}) {
  const lang = props.language;
  const forwards = props.host.forwards ?? [];
  const runningCount = forwards.filter((item) => item.status === "running").length;
  return props.renderCard(
      <HostCardHeader
        language={lang}
        host={props.host}
        expanded={props.expanded}
        compact={props.compact}
        dragHandle={props.dragHandle}
        accentClassName="bg-blue-600/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
        summary={(
          <>
            {runningCount > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {runningCount} {t(lang, "runningCount")}
              </span>
            )}
            {!props.compact && <span>{forwards.length} {t(lang, "forwardsCount")}</span>}
          </>
        )}
        onToggle={props.onToggle}
        onTogglePin={props.onTogglePin}
      />,

      props.expanded && (
        <div className="host-detail-content min-w-0 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button onClick={props.onNewForward}>
              <Plus size={15} />
              {t(lang, "newForward")}
            </Button>
            <Button variant="secondary" onClick={props.onDisconnectHost} disabled={runningCount === 0}>
              <Power size={15} />
              {t(lang, "stopAll")}
            </Button>
          </div>

          {forwards.length === 0 ? (
            <p className={cn("rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400", "dark:border-slate-800 dark:text-slate-500")}>
              {t(lang, "noForwards")}
            </p>
          ) : (
            <div className="forward-rules grid max-h-64 auto-rows-max grid-cols-1 gap-2 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
              {forwards.map((forward) => (
                <ForwardRow
                  key={forward.id}
                  language={lang}
                  forward={forward}
                  onConnect={() => props.onConnectForward(forward)}
                  onDisconnect={() => props.onDisconnectForward(forward)}
                  onOpenWeb={() => props.onOpenForwardWeb(forward)}
                  onEdit={() => props.onEditForward(forward)}
                  onDelete={() => props.onDeleteForward(forward)}
                />
              ))}
            </div>
          )}
        </div>
      ),
  );
}
