import { Activity, BookOpen, FolderSync, History, Network, ScrollText, Settings as SettingsIcon, Terminal, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { t } from "../i18n";
import { cn } from "../lib/utils";
import type { Language } from "../types";

export type AppPage = "dashboard" | "remote" | "files" | "forwarding" | "logs" | "settings" | "guide";

type NavItem = { id: AppPage; label: string; icon: LucideIcon };

const sidebarWidthKey = "sshdeck.sidebar.width";
const defaultWidth = 232;
const minWidth = 192;
const maxWidth = 320;

function clampWidth(width: number) {
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
}

function readWidth() {
  try {
    const stored = localStorage.getItem(sidebarWidthKey);
    if (stored && Number.isFinite(Number(stored))) return clampWidth(Number(stored));
  } catch {
    // Storage may be unavailable.
  }
  return defaultWidth;
}

function saveWidth(width: number) {
  try {
    localStorage.setItem(sidebarWidthKey, String(width));
  } catch {
    // Resizing still works for this session.
  }
}

export function AppSidebar(props: {
  language: Language;
  page: AppPage;
  onNavigate: (page: AppPage) => void;
}) {
  const [width, setWidth] = useState(readWidth);
  const nav: NavItem[] = [
    { id: "dashboard", label: t(props.language, "dashboard"), icon: Activity },
    { id: "remote", label: t(props.language, "remoteConnections"), icon: History },
    { id: "files", label: t(props.language, "fileTransfer"), icon: FolderSync },
    { id: "forwarding", label: t(props.language, "portForwarding"), icon: Network },
    { id: "logs", label: t(props.language, "logs"), icon: ScrollText },
    { id: "settings", label: t(props.language, "settings"), icon: SettingsIcon },
    { id: "guide", label: t(props.language, "guide"), icon: BookOpen },
  ];

  return (
    <aside
      className="relative z-10 h-full shrink-0 border-r border-slate-200/80 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/60"
      style={{ width }}
    >
      <div id="app-navigation" className="grid h-full grid-rows-[minmax(min-content,1fr)_auto_1fr] gap-y-8 overflow-y-auto px-3.5 py-5">
        <div className="flex flex-col items-start gap-3 self-start">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white shadow-soft">
            <Terminal size={21} aria-hidden />
          </span>
          <span className="text-3xl font-semibold tracking-tight">{t(props.language, "title")}</span>
        </div>
        <nav className="space-y-2">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => props.onNavigate(id)}
              aria-current={props.page === id ? "page" : undefined}
              title={label}
              className={cn(
                "flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-3 text-left text-base font-medium leading-5 transition duration-200",
                props.page === id
                  ? "bg-blue-600 text-white shadow-soft"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
              )}
            >
              <Icon size={18} className="shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{label}</span>
            </button>
          ))}
        </nav>
      </div>
      <SidebarDivider width={width} onResize={setWidth} label={t(props.language, "resizeSidebar")} />
    </aside>
  );
}

function SidebarDivider({ width, onResize, label }: {
  width: number;
  onResize: (width: number) => void;
  label: string;
}) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null);
  return (
    <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-controls="app-navigation"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        title={label}
        tabIndex={0}
        className="absolute inset-y-0 right-0 w-2.5 translate-x-1/2 cursor-col-resize touch-none before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-blue-500 before:opacity-0 before:transition-opacity hover:before:opacity-100 focus-visible:outline-none focus-visible:before:opacity-100 active:before:opacity-100"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, width };
        }}
        onPointerMove={(event) => {
          const resize = drag.current;
          if (resize?.pointerId !== event.pointerId) return;
          resize.width = clampWidth(resize.startWidth + event.clientX - resize.startX);
          onResize(resize.width);
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          saveWidth(drag.current.width);
          drag.current = null;
        }}
        onKeyDown={(event) => {
          let next: number;
          switch (event.key) {
            case "ArrowLeft": next = clampWidth(width - 12); break;
            case "ArrowRight": next = clampWidth(width + 12); break;
            case "Home": next = minWidth; break;
            case "End": next = maxWidth; break;
            default: return;
          }
          event.preventDefault();
          onResize(next);
          saveWidth(next);
        }}
    />
  );
}
