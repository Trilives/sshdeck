import { ModalOverlay } from "../components/ui/ModalOverlay";
import { LoaderCircle, X } from "lucide-react";
import type { Host, Language } from "../types";
import { DirectoryPicker } from "./DirectoryPicker";
import { FilePane } from "./FilePane";
import { useFileBrowser } from "./useFileBrowser";
import { recordFolderVisit } from "./folderHistory";
import { ft } from "./i18n";

/** Own a short-lived SFTP session; closing the picker also closes its connection. */
export function RemoteDirectoryPicker({
  host,
  language,
  onClose,
  onChoose,
  onOpenTerminal,
  onOpenVscode,
}: {
  host: Host;
  language: Language;
  onClose: () => void;
  onChoose: (path: string) => void;
  onOpenTerminal: (path: string) => void;
  onOpenVscode: (path: string) => void;
}) {
  const browser = useFileBrowser(host.id, true);
  if (browser.listing)
    return (
      <DirectoryPicker
        language={language}
        hostId={host.id}
        hostName={host.name || host.sshHost}
        listing={browser.listing}
        onClose={onClose}
        openActions={{
          terminal: (path) => {
            recordFolderVisit(host.id, path);
            onOpenTerminal(path);
          },
          vscode: (path) => {
            recordFolderVisit(host.id, path);
            onOpenVscode(path);
          },
        }}
        onChoose={(path) => {
          recordFolderVisit(host.id, path);
          onChoose(path);
        }}
      />
    );
  return (
    <ModalOverlay
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6 backdrop-blur-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ft(language, "chooseDirectory")}
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-950"
      >
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold">
            {ft(language, "chooseDirectory")} · {host.name || host.sshHost}
          </h2>
          <button
            autoFocus
            onClick={onClose}
            aria-label={ft(language, "close")}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </header>
        {browser.busy ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <LoaderCircle size={18} className="animate-spin" />
            {ft(language, "connecting")}
          </div>
        ) : (
          <div className="h-80">
            <FilePane
              language={language}
              hosts={[host]}
              hostId={host.id}
              browser={browser}
            />
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}
