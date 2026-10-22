import { useEffect, useRef, useState } from "react";
import { KeyRound, LoaderCircle, Upload } from "lucide-react";
import type { Host, Language } from "../types";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { ModalOverlay } from "../components/ui/ModalOverlay";
import { ft } from "./i18n";

export function FileAuthentication({
  host,
  language: lang,
  onClose,
  onConnect,
}: {
  host: Host;
  language: Language;
  onClose: () => void;
  onConnect: (password?: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function upload() {
    if (busy) return;
    setBusy(true);
    setError("");
    const value = password;
    setPassword("");
    try {
      await api.uploadPublicKey(host.id, value);
      if (alive.current) onConnect();
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ModalOverlay className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={ft(lang, "authentication")}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-950"
        onSubmit={(e) => {
          e.preventDefault();
          if (password && !busy) onConnect(password);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h2 className="font-semibold">
          {ft(lang, "authentication")} · {host.name || host.sshHost}
        </h2>
        <p className="mt-2 text-xs leading-6 text-slate-500">
          {ft(lang, "uploadKeyHint")}
        </p>
        <input
          autoFocus
          type="password"
          autoComplete="current-password"
          aria-label={ft(lang, "password")}
          placeholder={ft(lang, "password")}
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          className="my-4 h-10 w-full rounded-xl border border-slate-200 bg-transparent px-3 text-sm outline-none focus:border-blue-400 dark:border-slate-700"
        />
        <p className="mb-4 text-xs leading-5 text-slate-400">
          {ft(lang, "passwordNote")}
        </p>
        {error && (
          <p
            role="alert"
            className="mb-4 max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs text-rose-500"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {ft(lang, "cancel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void upload()}
          >
            {busy ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {ft(lang, "uploadAndConnect")}
          </Button>
          <Button type="submit" disabled={!password || busy}>
            <KeyRound size={14} />
            {ft(lang, "passwordLogin")}
          </Button>
        </div>
      </form>
    </ModalOverlay>
  );
}
