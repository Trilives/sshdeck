import { useEffect, useId, useRef, useState } from "react";
import { Network, Plus, Server } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";
import { Button } from "./ui/button";

export function DashboardCreateMenu(props: {
  language: Language;
  onForwarding: () => void;
  onNewHost: () => void;
}) {
  const { language } = props;
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const items = [
    { label: t(language, "portForwarding"), icon: Network, action: props.onForwarding },
    { label: t(language, "newHost"), icon: Server, action: props.onNewHost },
  ];

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        root.current?.querySelector("button")?.focus();
      }}
    >
      <Button
        type="button"
        variant="ghost"
        className="h-10 w-10 bg-slate-50 px-0 text-slate-500 hover:bg-blue-50 hover:text-blue-600 aria-expanded:bg-blue-50 aria-expanded:text-blue-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-blue-950 dark:hover:text-blue-300 dark:aria-expanded:bg-blue-950 dark:aria-expanded:text-blue-300"
        aria-label={t(language, "new")}
        title={t(language, "new")}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={19} aria-hidden />
      </Button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-float dark:border-slate-800 dark:bg-slate-950"
        >
          {items.map(({ label, icon: Icon, action }) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              className="w-full justify-start gap-2.5 rounded-lg px-3"
              onClick={() => {
                setOpen(false);
                action();
              }}
            >
              <Icon size={16} className="text-blue-600 dark:text-blue-400" aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
