import { ModalOverlay } from "../components/ui/ModalOverlay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  HardDrive,
  LoaderCircle,
  Pencil,
  Search,
  Terminal,
  Code2,
  X,
} from "lucide-react";
import type { Language } from "../types";
import { api } from "../api";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { filesApi } from "./api";
import { ft } from "./i18n";
import { recentFolders } from "./folderHistory";
import { pathCrumbs } from "./utils";
import type { FileEntry, FileListing } from "./types";

type Node = { name: string; path: string };
type CachedDirectory = { entries: Node[]; error?: string };
type Visit = { path: string; remoteHistory: boolean };
const directoryNodes = (entries: FileEntry[]) =>
  entries
    .filter((e) => e.isDir && !e.isLink)
    .map(({ name, path }) => ({ name, path }));

export function DirectoryPicker({
  language: lang,
  hostId,
  hostName,
  listing,
  onClose,
  onChoose,
  openActions,
}: {
  language: Language;
  hostId: string;
  hostName: string;
  listing: FileListing;
  onClose: () => void;
  onChoose: (path: string) => void;
  openActions?: {
    terminal: (path: string) => void;
    vscode: (path: string) => void;
  };
}) {
  const initialCrumbs = pathCrumbs(listing.path);
  const [selected, setSelected] = useState(listing.path);
  const [valid, setValid] = useState(true);
  const [tab, setTab] = useState<"browse" | "history">("browse");
  const [expanded, setExpanded] = useState(
    () => new Set(initialCrumbs.map((c) => c.path)),
  );
  const [cache, setCache] = useState<Record<string, CachedDirectory>>(() => ({
    [listing.path]: { entries: directoryNodes(listing.entries) },
  }));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [visits, setVisits] = useState<Visit[]>(() =>
    recentFolders(hostId).map((v) => ({ path: v.path, remoteHistory: false })),
  );
  const [historyBusy, setHistoryBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [manualPath, setManualPath] = useState(listing.path);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const scroll = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const selectionRun = useRef(0);
  const inFlight = useRef(new Map<string, Promise<FileListing>>());
  const historyLoaded = useRef(false);
  const crumbs = useMemo(() => pathCrumbs(selected), [selected]);
  const roots = useMemo(
    () => [...new Set([...listing.roots, crumbs[0]?.path].filter(Boolean))],
    [listing.roots, crumbs],
  );
  const spine = useMemo(
    () =>
      new Map(
        crumbs
          .slice(0, -1)
          .map((c, i) => [
            c.path,
            { name: crumbs[i + 1].label, path: crumbs[i + 1].path },
          ]),
      ),
    [crumbs],
  );

  const load = useCallback(
    (path: string): Promise<FileListing> => {
      const existing = inFlight.current.get(path);
      if (existing) return existing;
      if (alive.current) setLoading((v) => new Set(v).add(path));
      const request = filesApi
        .list(listing.sessionId, path)
        .then((result) => {
          if (alive.current)
            setCache((v) => ({
              ...v,
              [path]: { entries: directoryNodes(result.entries) },
              [result.path]: { entries: directoryNodes(result.entries) },
            }));
          return result;
        })
        .catch((e) => {
          if (alive.current)
            setCache((v) => ({
              ...v,
              [path]: { entries: [], error: String(e) },
            }));
          throw e;
        })
        .finally(() => {
          inFlight.current.delete(path);
          if (alive.current)
            setLoading((v) => {
              const n = new Set(v);
              n.delete(path);
              return n;
            });
        });
      inFlight.current.set(path, request);
      return request;
    },
    [listing.sessionId],
  );

  useEffect(() => {
    alive.current = true;
    // The known ancestor chain is shown immediately; other branches load only when expanded.
    const root = initialCrumbs[0]?.path;
    if (root && root !== listing.path) void load(root).catch(() => {});
    return () => {
      alive.current = false;
      selectionRun.current++;
    };
  }, [load]);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setViewportHeight(el.clientHeight),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab]);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const elements = [
          ...node.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),[tabindex="0"]',
          ),
        ].filter((e) => e.getClientRects().length > 0);
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    node.addEventListener("keydown", key);
    return () => node.removeEventListener("keydown", key);
  }, [onClose]);
  useEffect(() => {
    if (tab !== "history" || historyLoaded.current || !hostId) return;
    historyLoaded.current = true;
    setHistoryBusy(true);
    void api
      .listHistory(hostId)
      .then((history) => {
        if (!alive.current) return;
        setVisits((current) => {
          const seen = new Set(current.map((v) => v.path));
          const imported: Visit[] = [];
          for (const h of history) {
            if (h.kind === "vscode" && h.label && !seen.has(h.label)) {
              seen.add(h.label);
              imported.push({ path: h.label, remoteHistory: true });
            }
          }
          return [...current, ...imported];
        });
      })
      .catch((e) => {
        if (alive.current) setHistoryError(String(e));
      })
      .finally(() => {
        if (alive.current) setHistoryBusy(false);
      });
  }, [tab, hostId]);

  async function select(path: string) {
    const run = ++selectionRun.current;
    setSelected(path);
    setManualPath(path);
    setValid(false);
    setError("");
    setTab("browse");
    setQuery("");
    setExpanded((v) => new Set([...v, ...pathCrumbs(path).map((c) => c.path)]));
    try {
      const result = await load(path);
      if (!alive.current || run !== selectionRun.current) return;
      setSelected(result.path);
      setManualPath(result.path);
      setExpanded(
        (v) => new Set([...v, ...pathCrumbs(result.path).map((c) => c.path)]),
      );
      setValid(true);
    } catch (e) {
      if (alive.current && run === selectionRun.current) setError(String(e));
    }
  }
  function toggle(path: string) {
    if (expanded.has(path)) {
      setExpanded((v) => {
        const n = new Set(v);
        n.delete(path);
        return n;
      });
      return;
    }
    setExpanded((v) => new Set(v).add(path));
    if (!cache[path] || cache[path].error) void load(path).catch(() => {});
  }
  const rows = useMemo(() => {
    const result: {
      node: Node;
      depth: number;
      root: boolean;
      error?: string;
    }[] = [];
    const walk = (node: Node, depth: number, root = false) => {
      if (depth > 128) return;
      result.push({ node, depth, root, error: cache[node.path]?.error });
      if (!expanded.has(node.path)) return;
      let children = cache[node.path]?.entries;
      if (!children) {
        const next = spine.get(node.path);
        children = next ? [next] : [];
      }
      for (const child of children) walk(child, depth + 1);
    };
    roots.forEach((path) => walk({ name: path, path }, 0, true));
    return query
      ? result.filter((r) =>
          r.node.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )
      : result;
  }, [roots, cache, expanded, spine, query]);
  const selectedIndex = rows.findIndex((r) => r.node.path === selected);
  useEffect(() => {
    if (tab !== "browse" || !scroll.current || selectedIndex < 0) return;
    const el = scroll.current;
    const top = selectedIndex * 36;
    if (top < el.scrollTop || top + 36 > el.scrollTop + el.clientHeight)
      el.scrollTop = Math.max(0, top - el.clientHeight / 2);
  }, [selectedIndex, tab]);
  const start = Math.max(0, Math.floor(scrollTop / 36) - 5);
  const end = Math.min(
    rows.length,
    start + Math.ceil(viewportHeight / 36) + 12,
  );
  const history = visits.filter((v) =>
    v.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  return (
    <ModalOverlay className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6 backdrop-blur-sm">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-picker-title"
        className="flex max-h-[calc(100vh-48px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950"
      >
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h2 id="directory-picker-title" className="text-base font-semibold">
              {ft(lang, "chooseDirectory")}{" "}
              <span className="text-sm font-normal text-slate-400">
                · {hostName}
              </span>
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {ft(lang, openActions ? "openFolderHint" : "browseHint")}
            </p>
          </div>
          <button
            aria-label={ft(lang, "close")}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 pb-3 dark:border-slate-800">
          <div
            className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900"
            role="tablist"
          >
            {(["browse", "history"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs",
                  tab === t
                    ? "bg-white font-medium text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-300"
                    : "text-slate-400",
                )}
                onClick={() => {
                  setTab(t);
                  setQuery("");
                  setScrollTop(0);
                }}
              >
                {ft(lang, t === "browse" ? "browseDirectory" : "folderHistory")}
              </button>
            ))}
          </div>
          <label className="ml-auto flex min-w-40 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-800">
            <Search size={13} className="text-slate-400" />
            <input
              type="search"
              className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
              aria-label={ft(lang, "filterFolders")}
              placeholder={ft(lang, "filterFolders")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setScrollTop(0);
                if (scroll.current) scroll.current.scrollTop = 0;
              }}
            />
          </label>
        </div>
        <div
          ref={scroll}
          className="h-[340px] min-h-36 overflow-auto px-3 py-2"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {tab === "browse" ? (
            <div
              role="tree"
              aria-label={ft(lang, "browseDirectory")}
              style={{ height: rows.length * 36, position: "relative" }}
            >
              <div
                style={{
                  position: "absolute",
                  top: start * 36,
                  left: 0,
                  right: 0,
                }}
              >
                {rows
                  .slice(start, end)
                  .map(({ node, depth, root, error: nodeError }) => (
                    <div
                      key={node.path}
                      role="treeitem"
                      aria-selected={selected === node.path}
                      aria-expanded={expanded.has(node.path)}
                      className={cn(
                        "flex h-9 items-center gap-2 rounded-lg px-2 text-xs",
                        selected === node.path
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                          : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900",
                      )}
                      style={{ paddingLeft: 8 + Math.min(depth, 12) * 18 }}
                    >
                      <button
                        className="flex h-7 w-5 shrink-0 items-center justify-center text-slate-400"
                        aria-label={`${ft(lang, expanded.has(node.path) ? "collapse" : "expand")} ${node.name}`}
                        onClick={() => toggle(node.path)}
                      >
                        {loading.has(node.path) ? (
                          <LoaderCircle size={12} className="animate-spin" />
                        ) : expanded.has(node.path) ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </button>
                      <button
                        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
                        title={nodeError || node.path}
                        onClick={() => void select(node.path)}
                      >
                        {root ? (
                          <HardDrive
                            size={16}
                            className="shrink-0 text-blue-400"
                          />
                        ) : (
                          <Folder
                            size={16}
                            className="shrink-0 text-amber-500"
                          />
                        )}
                        <span className="truncate">{node.name}</span>
                        {nodeError && (
                          <span className="ml-auto text-rose-400">!</span>
                        )}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {historyBusy && (
                <p className="flex items-center gap-2 p-3 text-xs text-slate-400">
                  <LoaderCircle size={13} className="animate-spin" />
                  {ft(lang, "loading")}
                </p>
              )}
              {historyError && (
                <p className="p-2 text-xs text-rose-500">
                  {ft(lang, "historyUnavailable")}
                </p>
              )}
              {history.map((v) => (
                <button
                  key={v.path}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                  onClick={() => void select(v.path)}
                >
                  <Clock3 size={16} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate font-mono text-xs"
                      title={v.path}
                    >
                      {v.path}
                    </span>
                    <span className="mt-1 block text-[10px] text-slate-400">
                      {ft(
                        lang,
                        v.remoteHistory ? "remoteFolders" : "recentFolders",
                      )}
                    </span>
                  </span>
                  <ChevronRight size={13} className="text-slate-300" />
                </button>
              ))}
              {!history.length && !historyBusy && (
                <p className="py-16 text-center text-xs text-slate-400">
                  {ft(lang, "noFolderHistory")}
                </p>
              )}
            </div>
          )}
        </div>
        <footer className="border-t border-slate-200 bg-slate-50/70 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/40">
          {error && (
            <p className="mb-3 max-h-20 overflow-auto whitespace-pre-wrap break-words text-xs text-rose-500">
              {error}
            </p>
          )}
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="shrink-0 text-slate-400">
              {ft(lang, "selectedFolder")}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono"
              title={selected}
            >
              {selected}
            </span>
            <button
              className="shrink-0 rounded-lg p-1 text-slate-400 hover:text-blue-500"
              title={ft(lang, "typePath")}
              aria-label={ft(lang, "typePath")}
              onClick={() => setManual((v) => !v)}
            >
              <Pencil size={13} />
            </button>
          </div>
          {manual && (
            <div className="mb-3 flex gap-2">
              <input
                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950"
                aria-label={ft(lang, "path")}
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void select(manualPath);
                }}
              />
              <Button
                variant="secondary"
                className="h-9 text-xs"
                onClick={() => void select(manualPath)}
              >
                {ft(lang, "openPath")}
              </Button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {ft(lang, "cancel")}
            </Button>
            {openActions ? (
              <>
                <Button
                  variant="secondary"
                  disabled={!valid || loading.has(selected)}
                  onClick={() => openActions.terminal(selected)}
                >
                  <Terminal size={16} />
                  {ft(lang, "openTerminal")}
                </Button>
                <Button
                  disabled={!valid || loading.has(selected)}
                  onClick={() => openActions.vscode(selected)}
                >
                  <Code2 size={16} />
                  {ft(lang, "openVscode")}
                </Button>
              </>
            ) : (
              <Button
                disabled={!valid || loading.has(selected)}
                onClick={() => onChoose(selected)}
              >
                {loading.has(selected) && (
                  <LoaderCircle size={14} className="animate-spin" />
                )}
                {ft(lang, "choosePath")}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </ModalOverlay>
  );
}
