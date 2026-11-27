import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Plus, Upload } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";
import { Button } from "./ui/button";

function Dropdown(props: {
  label: string;
  icon: typeof Download;
  items: { label: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const Icon = props.icon;
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" onClick={() => setOpen((value) => !value)}>
        <Icon size={16} />
        {props.label}
        <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-float dark:border-slate-800 dark:bg-slate-950">
          {props.items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HostTransferActions(props: {
  language: Language;
  onNewHost: () => void;
  onImportFromFile: () => void;
  onImportFromConfig: () => void;
  onExportToFile: () => void;
  onExportToConfig: () => void;
}) {
  const lang = props.language;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dropdown
        label={t(lang, "import")}
        icon={Download}
        items={[
          { label: t(lang, "importFromFile"), onClick: props.onImportFromFile },
          { label: t(lang, "importFromConfig"), onClick: props.onImportFromConfig },
        ]}
      />
      <Dropdown
        label={t(lang, "export")}
        icon={Upload}
        items={[
          { label: t(lang, "exportToFile"), onClick: props.onExportToFile },
          { label: t(lang, "exportToConfig"), onClick: props.onExportToConfig },
        ]}
      />
      <Button onClick={props.onNewHost}>
        <Plus size={16} />
        {t(lang, "newHost")}
      </Button>
    </div>
  );
}
