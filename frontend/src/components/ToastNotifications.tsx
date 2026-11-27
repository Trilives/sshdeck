import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { t } from "../i18n";
import type { Language } from "../types";

const AUTO_DISMISS_MS = 5_000;

interface ToastNotificationsProps {
  language: Language;
  error: string;
  notice: string;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

interface ToastItemProps {
  language: Language;
  message: string;
  tone: "error" | "success";
  dismiss: Dispatch<SetStateAction<string>>;
}

function ToastItem({ language, message, tone, dismiss }: ToastItemProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => dismiss(""), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dismiss, message]);

  if (!message) return null;

  const isError = tone === "error";
  const Icon = isError ? TriangleAlert : CircleCheck;

  return (
    <div
      role={isError ? "alert" : "status"}
      className={[
        "pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-float backdrop-blur-xl",
        "animate-[fadeIn_180ms_ease-out]",
        isError
          ? "border-rose-200/80 bg-rose-50/95 text-rose-700 dark:border-rose-900 dark:bg-rose-950/90 dark:text-rose-200"
          : "border-emerald-200/80 bg-emerald-50/95 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-200",
      ].join(" ")}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-pre-wrap leading-5">{message}</span>
      <button
        type="button"
        onClick={() => dismiss("")}
        className="shrink-0 rounded-lg p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        aria-label={t(language, "close")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastNotifications(props: ToastNotificationsProps) {
  return (
    <div className="pointer-events-none fixed right-6 top-5 z-40 flex w-[min(26rem,calc(100vw-3rem))] flex-col gap-3" aria-live="polite">
      <ToastItem language={props.language} message={props.error} tone="error" dismiss={props.setError} />
      <ToastItem language={props.language} message={props.notice} tone="success" dismiss={props.setNotice} />
    </div>
  );
}
