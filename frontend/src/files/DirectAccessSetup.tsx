import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, LoaderCircle } from "lucide-react";
import type { Language } from "../types";
import { InputPasswordDialog } from "../components/dialogs";
import { Button } from "../components/ui/button";
import { filesApi } from "./api";
import { ft } from "./i18n";

export function DirectAccessSetup({
  language: lang,
  sourceName,
  requests,
  targetNames,
  onBusy,
}: {
  language: Language;
  sourceName: string;
  requests: { sourceSession: string; targetSession: string }[];
  targetNames: string[];
  onBusy: (busy: boolean) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [ready, setReady] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [prompt, setPrompt] = useState<{
    index: number;
    side: "source" | "target";
  } | null>(null);
  const [password, setPassword] = useState("");
  const credentials = useRef<{ source?: string; target?: string }>({});
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      credentials.current = {};
    };
  }, []);
  const busy = active !== null || prompt !== null;
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  async function configure(index: number) {
    if (locked.current) return;
    locked.current = true;
    setActive(index);
    setReady((previous) => {
      const next = new Set(previous);
      next.delete(index);
      return next;
    });
    setPrompt(null);
    setErrors((previous) => ({ ...previous, [index]: "" }));
    const request = requests[index];
    try {
      const result = await filesApi.setupDirect(
        request.sourceSession,
        request.targetSession,
        credentials.current.source,
        credentials.current.target,
      );
      if (!alive.current) return;
      if (result.ready) {
        setReady((previous) => new Set([...previous, index]));
        setSkipped((previous) => {
          const next = new Set(previous);
          if (result.alreadyReady) next.add(index);
          else next.delete(index);
          return next;
        });
        credentials.current = {};
      } else if (result.passwordFor) {
        delete credentials.current[result.passwordFor];
        setPrompt({ index, side: result.passwordFor });
      } else {
        throw new Error(ft(lang, "sessionLost"));
      }
    } catch (error) {
      credentials.current = {};
      if (alive.current)
        setErrors((previous) => ({ ...previous, [index]: String(error) }));
    } finally {
      locked.current = false;
      if (alive.current) setActive(null);
    }
  }
  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <p className="mb-2 text-[11px] leading-5 text-slate-400">
        {ft(lang, "setupDirectHint")}
      </p>
      {requests.map((request, index) => (
        <div key={request.targetSession} className="mb-2 last:mb-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-all text-xs text-slate-500">
              {sourceName} → {targetNames[index]}
            </span>
            <Button
              variant="secondary"
              className="h-8 px-2 text-[11px]"
              disabled={busy}
              onClick={() => {
                credentials.current = {};
                void configure(index);
              }}
            >
              {active === index ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : ready.has(index) ? (
                <Check size={13} />
              ) : (
                <KeyRound size={13} />
              )}
              {ft(
                lang,
                active === index
                  ? "setupWorking"
                  : ready.has(index)
                    ? skipped.has(index)
                      ? "alreadyPasswordless"
                      : "setupReady"
                    : "setupDirect",
              )}
            </Button>
          </div>
          {errors[index] && (
            <p
              role="alert"
              className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] text-rose-500"
            >
              {errors[index]}
            </p>
          )}
        </div>
      ))}
      {prompt && (
        <InputPasswordDialog
          language={lang}
          title={`${ft(lang, "setupDirect")} · ${prompt.side === "source" ? sourceName : targetNames[prompt.index]}`}
          description={ft(lang, "setupPasswordHint")}
          password={password}
          setPassword={setPassword}
          submitLabel={ft(lang, "continue")}
          onCancel={() => {
            setPassword("");
            credentials.current = {};
            setPrompt(null);
          }}
          onSubmit={() => {
            if (!password || locked.current) return;
            credentials.current[prompt.side] = password;
            setPassword("");
            void configure(prompt.index);
          }}
        />
      )}
    </div>
  );
}
