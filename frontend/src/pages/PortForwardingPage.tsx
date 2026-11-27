import { Card, CardHeader, CardTitle } from "../components/ui/card";
import { HostCard } from "../components/HostCard";
import { SortableHostList } from "../components/SortableHostList";
import { t } from "../i18n";
import type { Forward, Host, Language } from "../types";

export function PortForwardingPage(props: {
  language: Language;
  hosts: Host[];
  autoSortHosts: boolean;
  onMoveHost: (id: string, targetId: string) => Promise<void>;
  expandedIds: Set<string>;
  onToggle: (hostId: string) => void;
  onTogglePin: (host: Host) => void;
  onNewForward: (host: Host) => void;
  onDisconnectHost: (host: Host) => void;
  onConnectForward: (host: Host, forward: Forward) => void;
  onDisconnectForward: (host: Host, forward: Forward) => void;
  onOpenForwardWeb: (host: Host, forward: Forward) => void;
  onEditForward: (host: Host, forward: Forward) => void;
  onDeleteForward: (host: Host, forward: Forward) => void;
}) {
  const lang = props.language;
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t(lang, "configTitle")}</CardTitle>
        </CardHeader>
        {props.hosts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
            {t(lang, "noForwardingHosts")}
          </p>
        ) : (
          <SortableHostList hosts={props.hosts} language={lang} autoSort={props.autoSortHosts} onMove={props.onMoveHost}>
            {(host, dragHandle) => (
              <HostCard
                language={lang}
                host={host}
                dragHandle={dragHandle}
                expanded={props.expandedIds.has(host.id)}
                onToggle={() => props.onToggle(host.id)}
                onNewForward={() => props.onNewForward(host)}
                onDisconnectHost={() => props.onDisconnectHost(host)}
                onTogglePin={() => props.onTogglePin(host)}
                onConnectForward={(forward) => props.onConnectForward(host, forward)}
                onDisconnectForward={(forward) => props.onDisconnectForward(host, forward)}
                onOpenForwardWeb={(forward) => props.onOpenForwardWeb(host, forward)}
                onEditForward={(forward) => props.onEditForward(host, forward)}
                onDeleteForward={(forward) => props.onDeleteForward(host, forward)}
              />
            )}
          </SortableHostList>
        )}
      </Card>
    </div>
  );
}
