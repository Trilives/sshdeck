import { Activity, BookOpen, FolderSync, History, Network, ScrollText, Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { AppPage } from "./AppSidebar";

const icons = {
  dashboard: Activity,
  remote: History,
  files: FolderSync,
  forwarding: Network,
  logs: ScrollText,
  settings: Settings,
  guide: BookOpen,
};

export function PageHeader({ page, children, actions }: {
  page: AppPage;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = icons[page];
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h1 className="flex min-w-0 items-center gap-2.5 text-2xl font-semibold leading-tight text-slate-950 dark:text-slate-50">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
          <Icon size={19} aria-hidden />
        </span>
        {children}
      </h1>
      {actions}
    </header>
  );
}
