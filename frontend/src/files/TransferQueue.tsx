import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleX,
  Clock3,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { Language } from "../types";
import type { TransferProgress } from "./types";
import { ft } from "./i18n";
import { bytes } from "./utils";

export function isActive(job: TransferProgress) {
  return ["queued", "scanning", "running"].includes(job.status);
}
export function TransferQueue({
  language: lang,
  jobs,
  onCancel,
  onRetry,
  onClear,
  canRetry,
  height,
  setHeight,
  error,
}: {
  language: Language;
  jobs: TransferProgress[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onClear: () => void;
  canRetry: (id: string) => boolean;
  height: number;
  setHeight: (n: number) => void;
  error: string;
}) {
  const active = jobs.filter(isActive).length;
  const collapsed = height === 44;
  return (
    <section
      className="relative flex shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/80"
      style={{ height }}
    >
      <div
        className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize touch-none"
        title={ft(lang, "resize")}
        onPointerDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startHeight = height;
          const move = (ev: PointerEvent) =>
            setHeight(
              Math.min(360, Math.max(100, startHeight + startY - ev.clientY)),
            );
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
        }}
      />
      <div className="flex h-[43px] shrink-0 items-center gap-2 border-b border-slate-100 px-4 dark:border-slate-800">
        <h2 className="text-xs font-semibold">{ft(lang, "queue")}</h2>
        {active > 0 && (
          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
            {active}
          </span>
        )}
        <span className="flex-1" />
        <button
          className="text-[11px] text-slate-400 hover:text-blue-500"
          onClick={onClear}
        >
          {ft(lang, "clear")}
        </button>
        <button
          className="ml-2 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          title={ft(lang, collapsed ? "expandQueue" : "collapseQueue")}
          onClick={() => setHeight(collapsed ? 190 : 44)}
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          {error && (
            <p className="px-4 py-2 text-xs text-rose-500">
              {ft(lang, "queueUnavailable")}: {error}
            </p>
          )}
          {!jobs.length ? (
            <div className="flex h-full min-h-20 items-center justify-center gap-2 text-xs text-slate-400">
              <Clock3 size={16} />
              {ft(lang, "noJobs")}
            </div>
          ) : (
            jobs
              .slice()
              .reverse()
              .map((job) => {
                const active = isActive(job);
                const finished = job.status === "completed";
                const progress = finished
                  ? 100
                  : job.bytesTotal
                    ? Math.min(
                        99,
                        Math.floor((job.bytesDone / job.bytesTotal) * 100),
                      )
                    : 0;
                const remaining =
                  job.speed > 0
                    ? Math.ceil((job.bytesTotal - job.bytesDone) / job.speed)
                    : 0;
                return (
                  <div
                    key={job.id}
                    className="border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800/60"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      {active ? (
                        job.status === "queued" ? (
                          <Clock3
                            size={14}
                            className="shrink-0 text-slate-400"
                          />
                        ) : (
                          <LoaderCircle
                            size={14}
                            className="shrink-0 animate-spin text-blue-500"
                          />
                        )
                      ) : finished ? (
                        <CheckCircle2
                          size={14}
                          className="shrink-0 text-emerald-500"
                        />
                      ) : (
                        <CircleX
                          size={14}
                          className={cn(
                            "shrink-0",
                            job.status === "failed"
                              ? "text-rose-500"
                              : "text-slate-400",
                          )}
                        />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate font-medium"
                        title={`${job.source} → ${job.target}\n${job.destination}`}
                      >
                        {job.source}
                        <span className="mx-2 text-slate-300">→</span>
                        {job.target}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-400 dark:bg-slate-800">
                        {ft(lang, job.direct ? "directBadge" : "relayBadge")}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[10px]",
                          job.status === "failed"
                            ? "text-rose-500"
                            : finished
                              ? "text-emerald-500"
                              : "text-slate-400",
                        )}
                      >
                        {ft(lang, job.status)}
                      </span>
                      {active ? (
                        <button
                          className="ml-1 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/20"
                          title={ft(lang, "cancel")}
                          onClick={() => onCancel(job.id)}
                        >
                          <X size={14} />
                        </button>
                      ) : (
                        canRetry(job.id) &&
                        (job.status === "failed" ||
                          job.status === "cancelled") && (
                          <button
                            title={ft(lang, "retry")}
                            className="ml-1 rounded p-1 text-slate-400 hover:text-blue-500"
                            onClick={() => onRetry(job.id)}
                          >
                            <RotateCcw size={14} />
                          </button>
                        )
                      )}
                    </div>
                    {(job.status === "running" || finished) && (
                      <>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-300",
                              finished ? "bg-emerald-500" : "bg-blue-500",
                            )}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tabular-nums text-slate-400">
                          <span
                            className="min-w-0 flex-1 truncate"
                            title={job.currentFile}
                          >
                            {job.currentFile || job.destination}
                          </span>
                          <span>
                            {job.direct && !finished
                              ? `${ft(lang, "estimated")} `
                              : ""}
                            {progress}%
                          </span>
                          <span>
                            {bytes(job.bytesDone)} / {bytes(job.bytesTotal)}
                          </span>
                          {job.speed > 0 && <span>{bytes(job.speed)}/s</span>}
                          {remaining > 0 && (
                            <span>
                              {ft(lang, "remaining")}{" "}
                              {remaining < 60
                                ? `${remaining} ${ft(lang, "seconds")}`
                                : `${Math.ceil(remaining / 60)} ${ft(lang, "minutes")}`}
                            </span>
                          )}
                          <span>
                            {job.filesDone}/{job.filesTotal}
                          </span>
                          {job.skipped > 0 && (
                            <span>
                              {ft(lang, "skipped")} {job.skipped}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                    {job.error && (
                      <p className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-rose-500 dark:text-rose-300">
                        {job.error}
                      </p>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}
    </section>
  );
}
