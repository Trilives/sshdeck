import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Copy,
  FolderSync,
  Info,
  LoaderCircle,
  Network,
  Send,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import type { Host, Language } from "../types";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { filesApi } from "../files/api";
import { FilePane, type FileDrop } from "../files/FilePane";
import {
  DistributionTargets,
  type PathCommand,
  type Recipient,
} from "../files/DistributionTargets";
import { TransferQueue, isActive } from "../files/TransferQueue";
import { useFileBrowser } from "../files/useFileBrowser";
import { ft } from "../files/i18n";
import type {
  ConflictPolicy,
  FileEntry,
  TransferProgress,
  TransferRequest,
} from "../files/types";

interface Pending {
  requests: Omit<TransferRequest, "conflict">[];
  sources: string[];
  targetNames: string[];
}
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function FileTransferPage({
  language: lang,
  hosts,
  active,
}: {
  language: Language;
  hosts: Host[];
  active: boolean;
}) {
  const [visited, setVisited] = useState(false);
  const [leftId, setLeftId] = useState(() => stored("sshdeck.file.left") || "");
  const [rightId, setRightId] = useState(
    () => stored("sshdeck.file.right") || "",
  );
  const rightInitialised = useRef(stored("sshdeck.file.right") !== null);
  const [leftSelection, setLeftSelection] = useState<FileEntry[]>([]);
  const [rightSelection, setRightSelection] = useState<FileEntry[]>([]);
  const left = useFileBrowser(leftId, visited);
  const right = useFileBrowser(rightId, visited);
  const [distribution, setDistribution] = useState(false);
  const [direct, setDirect] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<Record<string, Recipient>>({});
  const [pathCommand, setPathCommand] = useState<PathCommand | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState<ConflictPolicy>("skip");
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<TransferProgress[]>([]);
  const [error, setError] = useState("");
  const [queueError, setQueueError] = useState("");
  const [hiddenJobs, setHiddenJobs] = useState<Set<string>>(new Set());
  const [queueHeight, setQueueHeight] = useState(() =>
    window.innerHeight < 820 ? 140 : 190,
  );
  const [split, setSplit] = useState(50);
  const [recipientRefresh, setRecipientRefresh] = useState(0);
  const splitContainer = useRef<HTMLDivElement>(null);
  const requests = useRef(new Map<string, TransferRequest>());
  const completed = useRef(new Set<string>());
  const refreshPanels = useRef(() => {});
  refreshPanels.current = () => {
    left.refresh();
    right.refresh();
    setRecipientRefresh((v) => v + 1);
  };
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  useEffect(() => {
    if (visited && !rightInitialised.current && hosts.length) {
      rightInitialised.current = true;
      setRightId(hosts[0].id);
    }
  }, [visited, hosts]);
  useEffect(() => {
    if (!visited) return;
    try {
      localStorage.setItem("sshdeck.file.left", leftId);
      localStorage.setItem("sshdeck.file.right", rightId);
    } catch {
      /* unavailable */
    }
  }, [leftId, rightId, visited]);
  const onRecipient = useCallback(
    (id: string, r: Recipient | null) =>
      setRecipients((prev) => {
        if (!r) {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }
        const old = prev[id];
        if (
          old &&
          old.sessionId === r.sessionId &&
          old.path === r.path &&
          old.busy === r.busy &&
          old.error === r.error
        )
          return prev;
        return { ...prev, [id]: r };
      }),
    [],
  );
  const directAvailable =
    !!leftId &&
    (distribution
      ? selectedRecipients.length > 0 && selectedRecipients.every(Boolean)
      : !!rightId);
  useEffect(() => {
    if (!directAvailable) setDirect(false);
  }, [directAvailable]);
  useEffect(() => {
    if (!visited) return;
    let disposed = false;
    let polling = false;
    let unlisten: (() => void) | undefined;
    const receive = (job: TransferProgress) => {
      if (disposed) return;
      setJobs((prev) => {
        const old = prev.find((p) => p.id === job.id);
        if (old && !isActive(old) && isActive(job)) return prev;
        return old
          ? prev.map((p) => (p.id === job.id ? job : p))
          : [...prev, job];
      });
      if (job.status === "completed" && !completed.current.has(job.id)) {
        completed.current.add(job.id);
        refreshPanels.current();
      }
    };
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await filesApi.jobs();
        if (!disposed) {
          next.forEach(receive);
          setQueueError("");
        }
      } catch (e) {
        if (!disposed) setQueueError(String(e));
      } finally {
        polling = false;
      }
    };
    void listen<TransferProgress>("file-transfer", (e) => receive(e.payload))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* polling remains available */
      });
    void poll();
    const timer = window.setInterval(() => void poll(), 1200);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      unlisten?.();
    };
  }, [visited]);

  function targetName(id: string) {
    return id
      ? hosts.find((h) => h.id === id)?.name ||
          hosts.find((h) => h.id === id)?.sshHost ||
          ft(lang, "unnamed")
      : ft(lang, "local");
  }
  function prepare(
    source: "left" | "right",
    paths?: string[],
    destination?: string,
  ) {
    setError("");
    const from = source === "left" ? left : right;
    const to = source === "left" ? right : left;
    const chosen =
      paths ||
      (source === "left" ? leftSelection : rightSelection).map((e) => e.path);
    if (!from.listing || !chosen.length || from.busy) {
      setError(ft(lang, "invalidSelection"));
      return;
    }
    let targets: { sessionId: string; path: string; name: string }[] = [];
    if (distribution && source === "left") {
      if (!selectedRecipients.length) {
        setError(ft(lang, "noRecipients"));
        return;
      }
      for (const id of selectedRecipients) {
        const r = recipients[id];
        if (!r?.sessionId || r.busy || r.error) {
          setError(`${targetName(id)}: ${ft(lang, "chooseTarget")}`);
          return;
        }
        targets.push({
          sessionId: r.sessionId,
          path: r.path,
          name: targetName(id),
        });
      }
    } else {
      if (!to.listing || to.busy) {
        setError(ft(lang, "chooseTarget"));
        return;
      }
      targets = [
        {
          sessionId: to.listing.sessionId,
          path: destination || to.listing.path,
          name: targetName(source === "left" ? rightId : leftId),
        },
      ];
    }
    setPending({
      requests: targets.map((t) => ({
        sourceSession: from.listing!.sessionId,
        targetSession: t.sessionId,
        paths: chosen,
        destination: t.path,
        direct: direct && directAvailable,
      })),
      sources: chosen,
      targetNames: targets.map((t) => t.name),
    });
  }
  function dropped(side: "left" | "right", drop: FileDrop, path: string) {
    const source =
      drop.sessionId === left.listing?.sessionId
        ? "left"
        : drop.sessionId === right.listing?.sessionId
          ? "right"
          : null;
    if (!source || source === side) return;
    prepare(source, drop.paths, path);
  }
  async function startPending() {
    if (!pending || submitting) return;
    setSubmitting(true);
    setError("");
    const failures: string[] = [];
    try {
      for (let i = 0; i < pending.requests.length; i++) {
        const request = { ...pending.requests[i], conflict };
        try {
          const job = await filesApi.start(request);
          requests.current.set(job.id, request);
          setJobs((prev) =>
            prev.some((p) => p.id === job.id) ? prev : [...prev, job],
          );
        } catch (e) {
          failures.push(`${pending.targetNames[i]}: ${String(e)}`);
        }
      }
      setPending(null);
      setQueueHeight((h) => Math.max(h, 150));
      if (failures.length) setError(failures.join("\n"));
    } finally {
      setSubmitting(false);
    }
  }
  async function retry(id: string) {
    const request = requests.current.get(id);
    if (!request) return;
    try {
      const job = await filesApi.start(request);
      requests.current.set(job.id, request);
      setJobs((prev) =>
        prev.some((p) => p.id === job.id) ? prev : [...prev, job],
      );
    } catch (e) {
      setError(String(e));
    }
  }
  const footer = (side: "left" | "right") => (
    <Button
      className="h-8 px-2.5 text-[11px]"
      disabled={
        !(side === "left" ? leftSelection : rightSelection).length ||
        (side === "left" ? left.busy : right.busy)
      }
      onClick={() => prepare(side)}
    >
      {side === "right" && <ArrowLeft size={13} />}{" "}
      {ft(
        lang,
        distribution && side === "left"
          ? "distribute"
          : side === "left"
            ? "sendRight"
            : "sendLeft",
      )}{" "}
      {side === "left" &&
        (distribution ? <Send size={12} /> : <ArrowRight size={13} />)}
    </Button>
  );
  return (
    <div className="flex h-[calc(100vh-48px)] min-h-[560px] min-w-0 flex-col gap-3">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-300">
              <FolderSync size={19} />
            </span>
            {ft(lang, "title")}
          </h1>
          <p className="mt-1.5 hidden text-xs text-slate-400 xl:block">
            {ft(lang, "subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={direct}
            disabled={!directAvailable}
            onClick={() => setDirect((v) => !v)}
            title={ft(lang, directAvailable ? "directHint" : "directDisabled")}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs transition",
              direct
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                : "border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400",
              !directAvailable && "cursor-not-allowed opacity-40",
            )}
          >
            <Network size={13} />
            {ft(lang, "direct")}
          </button>
          <button
            aria-pressed={distribution}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition",
              distribution
                ? "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
                : "border-slate-200 text-slate-500 hover:bg-white dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-900",
            )}
            onClick={() => setDistribution((v) => !v)}
          >
            <Copy size={13} />
            {ft(lang, "distribution")}
          </button>
        </div>
      </header>
      <div
        className={cn(
          "flex shrink-0 items-start gap-2 rounded-xl px-3 py-2 text-[11px] leading-5",
          direct
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"
            : "bg-slate-100/80 text-slate-400 dark:bg-slate-900/60",
        )}
      >
        <Info size={13} className="mt-0.5 shrink-0" />
        <p>{ft(lang, direct ? "directHint" : "relayHint")}</p>
      </div>
      {error && (
        <div className="flex shrink-0 items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/25 dark:text-rose-300">
          <p className="max-h-24 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words">
            {error}
          </p>
          <button aria-label={ft(lang, "close")} onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <div
        ref={splitContainer}
        className="flex min-h-[260px] min-w-0 flex-1 gap-0"
      >
        <div
          className="min-h-0 min-w-0"
          style={{ width: `calc(${split}% - 9px)` }}
        >
          <FilePane
            language={lang}
            hosts={hosts}
            hostId={leftId}
            onHostChange={setLeftId}
            browser={left}
            onSelection={setLeftSelection}
            onDropFiles={
              distribution
                ? undefined
                : (drop, path) => dropped("left", drop, path)
            }
            footer={footer("left")}
          />
        </div>
        <div
          className="group relative flex w-[18px] shrink-0 cursor-col-resize touch-none items-center justify-center"
          title={ft(lang, "resize")}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            e.preventDefault();
            const move = (ev: PointerEvent) => {
              const rect = splitContainer.current?.getBoundingClientRect();
              if (rect)
                setSplit(
                  Math.max(
                    35,
                    Math.min(65, ((ev.clientX - rect.left) / rect.width) * 100),
                  ),
                );
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              window.removeEventListener("pointercancel", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", up);
          }}
        >
          <div className="h-12 w-1 rounded-full bg-slate-200 transition group-hover:bg-blue-300 dark:bg-slate-800 dark:group-hover:bg-blue-600" />
          {!distribution && (
            <button
              className="absolute top-4 rounded-full border border-slate-200 bg-white p-1 text-slate-400 shadow-sm hover:text-blue-500 dark:border-slate-700 dark:bg-slate-900"
              title={ft(lang, "swap")}
              onClick={() => {
                setLeftId(rightId);
                setRightId(leftId);
              }}
            >
              <ArrowLeftRight size={11} />
            </button>
          )}
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          <div className={cn("h-full", distribution && "hidden")}>
            <FilePane
              language={lang}
              hosts={hosts}
              hostId={rightId}
              onHostChange={setRightId}
              browser={right}
              onSelection={setRightSelection}
              onDropFiles={(drop, path) => dropped("right", drop, path)}
              footer={footer("right")}
            />
          </div>
          {distribution && (
            <DistributionTargets
              hosts={hosts}
              language={lang}
              selected={selectedRecipients}
              onToggle={(id) =>
                setSelectedRecipients((prev) =>
                  prev.includes(id)
                    ? prev.filter((i) => i !== id)
                    : [...prev, id],
                )
              }
              recipients={recipients}
              onChange={onRecipient}
              command={pathCommand}
              onApply={(path) =>
                setPathCommand((v) => ({
                  path,
                  version: (v?.version || 0) + 1,
                }))
              }
              refreshVersion={recipientRefresh}
            />
          )}
        </div>
      </div>
      <TransferQueue
        language={lang}
        jobs={jobs.filter((j) => !hiddenJobs.has(j.id))}
        onCancel={(id) =>
          void filesApi.cancel(id).catch((e) => setError(String(e)))
        }
        onRetry={(id) => void retry(id)}
        canRetry={(id) => requests.current.has(id)}
        onClear={() =>
          setHiddenJobs(
            (prev) =>
              new Set([
                ...prev,
                ...jobs.filter((j) => !isActive(j)).map((j) => j.id),
              ]),
          )
        }
        height={queueHeight}
        setHeight={setQueueHeight}
        error={queueError}
      />
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-title"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-950"
          >
            <h2 id="transfer-title" className="text-lg font-semibold">
              {ft(lang, "confirmTitle")}
            </h2>
            <p className="mt-2 text-xs leading-6 text-slate-400">
              {ft(lang, "confirmHint")}
            </p>
            <div className="my-4 max-h-44 overflow-auto rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900">
              <p className="mb-2 font-medium">
                {pending.sources.length} {ft(lang, "items")} →{" "}
                {pending.targetNames.length} {ft(lang, "allTargets")}
              </p>
              {pending.requests.map((r, i) => (
                <p
                  key={i}
                  className="mb-1 break-all text-slate-500 dark:text-slate-400"
                >
                  {pending.targetNames[i]}{" "}
                  <span className="font-mono">{r.destination}</span>
                </p>
              ))}
              <p className="mt-3 text-[10px] text-blue-500">
                {ft(
                  lang,
                  pending.requests[0]?.direct ? "directBadge" : "relayBadge",
                )}
              </p>
            </div>
            <label className="mb-5 flex items-center justify-between gap-3 text-xs">
              <span>{ft(lang, "conflict")}</span>
              <select
                value={conflict}
                onChange={(e) => setConflict(e.target.value as ConflictPolicy)}
                className="h-9 rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="skip">{ft(lang, "skip")}</option>
                <option value="overwrite">{ft(lang, "overwrite")}</option>
                <option value="rename">{ft(lang, "rename")}</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={submitting}
                onClick={() => setPending(null)}
              >
                {ft(lang, "cancel")}
              </Button>
              <Button disabled={submitting} onClick={() => void startPending()}>
                {submitting ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}{" "}
                {ft(lang, "confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
