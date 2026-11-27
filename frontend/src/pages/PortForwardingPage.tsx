import { Card } from "../components/ui/card";
import { PageHeader } from "../components/PageHeader";
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
    <div className="grid min-w-0 gap-4">
      <PageHeader page="forwarding">{t(lang, "configTitle")}</PageHeader>
      {props.hosts.length === 0 ? (
        <Card className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {t(lang, "noForwardingHosts")}
        </Card>
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
    </div>
  );
}
