import { Activity, BookOpen, FolderSync, History, Network, ScrollText, Settings as SettingsIcon, Terminal } from "lucide-react";
import { t } from "../i18n";
import { cn } from "../lib/utils";
import type { Language } from "../types";

export type AppPage = "dashboard" | "remote" | "files" | "forwarding" | "logs" | "settings" | "guide";

export function AppSidebar(props: {
  language: Language;
  page: AppPage;
  onNavigate: (page: AppPage) => void;
}) {
  const nav = [
    { id: "dashboard" as const, label: t(props.language, "dashboard"), icon: Activity },
    { id: "remote" as const, label: t(props.language, "remoteConnections"), icon: History },
    { id: "files" as const, label: t(props.language, "fileTransfer"), icon: FolderSync },
    { id: "forwarding" as const, label: t(props.language, "portForwarding"), icon: Network },
    { id: "logs" as const, label: t(props.language, "logs"), icon: ScrollText },
    { id: "settings" as const, label: t(props.language, "settings"), icon: SettingsIcon },
    { id: "guide" as const, label: t(props.language, "guide"), icon: BookOpen },
  ];

  return (
    <aside className="h-full w-72 shrink-0 overflow-hidden border-r border-slate-200/80 bg-white/80 p-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/60">
      <div className="mb-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-soft">
          <Terminal size={22} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-normal">{t(props.language, "title")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{t(props.language, "subtitle")}</p>
      </div>
      <nav className="space-y-2">
        {nav.map((item) => (
          <button
            key={item.id}
            onClick={() => props.onNavigate(item.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition duration-200",
              props.page === item.id
                ? "bg-blue-600 text-white shadow-soft"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
            )}
          >
            <item.icon size={18} />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
