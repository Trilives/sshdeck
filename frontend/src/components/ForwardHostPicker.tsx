import { useId, useState } from "react";
import { ChevronRight, Plus, Search, Server, X } from "lucide-react";
import { t } from "../i18n";
import type { Host, Language } from "../types";
import { Button } from "./ui/button";
import { Card, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { ModalOverlay } from "./ui/ModalOverlay";

export function ForwardHostPicker(props: {
  hosts: Host[];
  language: Language;
  onSelect: (hostId: string) => void;
  onNewHost: () => void;
  onClose: () => void;
}) {
  const { hosts, language, onClose } = props;
  const titleId = useId();
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const matches = hosts.filter((host) =>
    [host.name, host.sshHost].some((value) => value.toLowerCase().includes(term)),
  );

  return (
    <ModalOverlay
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <Card role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex w-full max-w-lg flex-col !overflow-hidden shadow-float">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <CardTitle id={titleId}>{t(language, "chooseForwardHost")}</CardTitle>
          <Button type="button" variant="ghost" className="h-8 w-8 px-0" onClick={onClose} aria-label={t(language, "close")}>
            <X size={16} aria-hidden />
          </Button>
        </div>
        {hosts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center dark:border-slate-800">
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t(language, "noForwardingHosts")}</p>
            <Button autoFocus type="button" onClick={props.onNewHost}>
              <Plus size={16} aria-hidden />
              {t(language, "newHost")}
            </Button>
          </div>
        ) : (
          <>
            <div className="relative mb-3 shrink-0">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t(language, "searchForwardHost")}
                placeholder={t(language, "searchForwardHost")}
                className="pl-9"
              />
            </div>
            <div className="grid min-h-0 grid-cols-1 gap-2 overflow-y-auto overscroll-contain rounded-xl">
              {matches.length ? matches.map((host) => {
                const address = (host.sshUser ? host.sshUser + "@" : "") + host.sshHost + ":" + (host.sshPort || "22");
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    key={host.id}
                    onClick={() => props.onSelect(host.id)}
                    className="h-auto min-w-0 justify-start gap-3 rounded-xl border border-slate-200 px-3 py-2 text-left focus-visible:ring-inset focus-visible:ring-offset-0 dark:border-slate-800"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                      <Server size={17} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold" title={host.name}>{host.name || host.sshHost}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400" title={address}>{address}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                      {host.forwards?.length ?? 0} {t(language, "forwardsCount")}
                    </span>
                    <ChevronRight size={15} className="shrink-0 text-slate-400" aria-hidden />
                  </Button>
                );
              }) : (
                <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {t(language, "noMatchingHosts")}
                </p>
              )}
            </div>
          </>
        )}
      </Card>
    </ModalOverlay>
  );
}
