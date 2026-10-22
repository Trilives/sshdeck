import { ModalOverlay } from "../components/ui/ModalOverlay";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderOpen,
  Home,
  KeyRound,
  Link2,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  Search,
  ShieldAlert,
  Unplug,
} from "lucide-react";
import type { Host, Language } from "../types";
import { api } from "../api";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { FileAuthentication } from "./FileAuthentication";
import { filesApi } from "./api";
import { ft } from "./i18n";
import { HostPicker } from "./HostPicker";
import { bytes, parentPath } from "./utils";
import { DirectoryPicker } from "./DirectoryPicker";
import type { FileBrowser } from "./useFileBrowser";
import type { FileEntry } from "./types";

export const FILE_DRAG = "application/x-sshdeck-files";
export interface FileDrop {
  sessionId: string;
  paths: string[];
}
type Row = { entry: FileEntry; depth: number };
const ROW_HEIGHT = 38;

export function FilePane(props: {
  language: Language;
  hosts: Host[];
  hostId: string;
  onHostChange?: (hostId: string) => void;
  browser: FileBrowser;
  onSelection?: (entries: FileEntry[]) => void;
  onDropFiles?: (drop: FileDrop, path: string) => void;
  footer?: ReactNode;
  compact?: boolean;
}) {
  const { language: lang, browser: b } = props;
  const [selected, setSelected] = useState<Map<string, FileEntry>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState<"name" | "size" | "modified">("name");
  const [descending, setDescending] = useState(false);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const closeDirectoryPicker = useCallback(
    () => setDirectoryPickerOpen(false),
    [],
  );
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [fingerprint, setFingerprint] = useState("");
  const [trustOpen, setTrustOpen] = useState(false);
  const [trustBusy, setTrustBusy] = useState(false);
  const [dropPath, setDropPath] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 400 });
  const scroller = useRef<HTMLDivElement>(null);
  const rootVersion = useRef(0);
  const anchor = useRef<string | null>(null);
  const onSelection = props.onSelection;

  useEffect(() => {
    setPasswordOpen(false);
    setTrustOpen(false);
  }, [props.hostId]);

  useEffect(() => {
    onSelection?.([...selected.values()]);
  }, [selected, onSelection]);
  useEffect(() => {
    rootVersion.current++;
    setSelected(new Map());
    setExpanded(new Set());
    setChildren({});
    setLoadingPaths(new Set());
    anchor.current = null;
    setDirectoryPickerOpen(false);
    setDropPath(null);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [b.revision, b.listing?.sessionId]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const resize = new ResizeObserver(() =>
      setViewport((v) => ({ ...v, height: element.clientHeight })),
    );
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (
      b.error &&
      /permission denied|authentication failed|incorrect passphrase/i.test(
        b.error,
      ) &&
      !b.listing
    )
      setPasswordOpen(true);
  }, [b.error, b.listing]);

  const rootEntries = b.listing?.entries;
  const rows = useMemo(() => {
    const out: Row[] = [];
    const q = filter.toLocaleLowerCase();
    const walk = (entries: FileEntry[], depth: number) => {
      const ordered = entries
        .filter(
          (e) =>
            (hidden || !e.name.startsWith(".")) &&
            (!q || e.name.toLocaleLowerCase().includes(q)),
        )
        .sort((a, c) => {
          if (a.isDir !== c.isDir) return a.isDir ? -1 : 1;
          const n =
            sort === "name"
              ? a.name.localeCompare(c.name, lang, { numeric: true })
              : a[sort] - c[sort];
          return descending ? -n : n;
        });
      for (const entry of ordered) {
        out.push({ entry, depth });
        if (expanded.has(entry.path) && children[entry.path])
          walk(children[entry.path], depth + 1);
      }
    };
    if (rootEntries) walk(rootEntries, 0);
    return out;
  }, [rootEntries, children, expanded, hidden, filter, sort, descending, lang]);
  const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - 6);
  const end = Math.min(
    rows.length,
    start + Math.ceil(viewport.height / ROW_HEIGHT) + 14,
  );

  function choose(entry: FileEntry, additive = false, range = false) {
    if (entry.isLink || (!entry.isDir && !entry.isFile)) return;
    setSelected((prev) => {
      const next =
        additive || range ? new Map(prev) : new Map<string, FileEntry>();
      if (range && anchor.current) {
        const a = rows.findIndex((r) => r.entry.path === anchor.current);
        const z = rows.findIndex((r) => r.entry.path === entry.path);
        if (a >= 0 && z >= 0)
          rows.slice(Math.min(a, z), Math.max(a, z) + 1).forEach((r) => {
            if (!r.entry.isLink && (r.entry.isDir || r.entry.isFile))
              next.set(r.entry.path, r.entry);
          });
      } else if (additive && next.has(entry.path)) next.delete(entry.path);
      else next.set(entry.path, entry);
      return next;
    });
    if (!range) anchor.current = entry.path;
  }
  async function toggle(entry: FileEntry) {
    if (expanded.has(entry.path)) {
      setExpanded((v) => {
        const n = new Set(v);
        n.delete(entry.path);
        return n;
      });
      return;
    }
    setExpanded((v) => new Set(v).add(entry.path));
    if (children[entry.path] || !b.listing || loadingPaths.has(entry.path))
      return;
    const version = rootVersion.current;
    setLoadingPaths((v) => new Set(v).add(entry.path));
    try {
      const result = await filesApi.list(b.listing.sessionId, entry.path);
      if (version === rootVersion.current)
        setChildren((prev) => ({ ...prev, [entry.path]: result.entries }));
    } catch (e) {
      if (version === rootVersion.current) {
        b.setError(String(e));
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(entry.path);
          return next;
        });
      }
    } finally {
      if (version === rootVersion.current)
        setLoadingPaths((v) => {
          const n = new Set(v);
          n.delete(entry.path);
          return n;
        });
    }
  }
  function sortBy(key: typeof sort) {
    if (sort === key) setDescending((v) => !v);
    else {
      setSort(key);
      setDescending(false);
    }
  }
  function dragStart(e: DragEvent, entry: FileEntry) {
    if (!b.listing || entry.isLink || (!entry.isDir && !entry.isFile)) {
      e.preventDefault();
      return;
    }
    const entries = selected.has(entry.path) ? [...selected.values()] : [entry];
    if (!selected.has(entry.path)) setSelected(new Map([[entry.path, entry]]));
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(
      FILE_DRAG,
      JSON.stringify({
        sessionId: b.listing.sessionId,
        paths: entries.map((e) => e.path),
      }),
    );
  }
  function dragOver(e: DragEvent, path: string) {
    if (
      !props.onDropFiles ||
      !e.dataTransfer.types.includes(FILE_DRAG) ||
      b.busy
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropPath(path);
  }
  function drop(e: DragEvent, path: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropPath(null);
    try {
      const payload: FileDrop = JSON.parse(e.dataTransfer.getData(FILE_DRAG));
      if (
        typeof payload.sessionId === "string" &&
        Array.isArray(payload.paths) &&
        payload.paths.every((p) => typeof p === "string")
      )
        props.onDropFiles?.(payload, path);
    } catch {
      /* unrelated drag */
    }
  }
  async function showTrust() {
    setTrustOpen(true);
    setTrustBusy(true);
    setFingerprint("");
    try {
      setFingerprint(await api.getHostFingerprint(props.hostId));
    } catch (e) {
      b.setError(String(e));
    } finally {
      setTrustBusy(false);
    }
  }
  const host = props.hosts.find((h) => h.id === props.hostId);
  const canSelect = rows.filter(
    (r) => !r.entry.isLink && (r.entry.isDir || r.entry.isFile),
  );
  const allSelected =
    canSelect.length > 0 && canSelect.every((r) => selected.has(r.entry.path));
  const iconButton =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100";
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/80">
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 px-2 py-2 dark:border-slate-800">
        {props.onHostChange ? (
          <HostPicker
            hosts={props.hosts}
            value={props.hostId}
            onChange={props.onHostChange}
            language={lang}
          />
        ) : (
          <div className="min-w-0 flex-1 px-2 py-2 text-sm font-semibold truncate">
            {host?.name || ft(lang, "local")}
          </div>
        )}
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            b.busy
              ? "animate-pulse bg-amber-400"
              : b.listing
                ? "bg-emerald-500"
                : "bg-slate-300 dark:bg-slate-600",
          )}
          title={ft(
            lang,
            b.busy ? "connecting" : b.listing ? "connected" : "disconnected",
          )}
        />
        {b.listing ? (
          <button
            className={iconButton}
            title={ft(lang, "disconnect")}
            onClick={b.disconnect}
          >
            <Unplug size={15} />
          </button>
        ) : (
          <button
            className={iconButton}
            title={ft(lang, "connect")}
            disabled={b.busy}
            onClick={() => void b.connect()}
          >
            {b.busy ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <PlugZap size={16} />
            )}
          </button>
        )}
        {!!props.hostId && (
          <button
            className={iconButton}
            title={ft(lang, "authentication")}
            onClick={() => {
              setPasswordOpen(true);
            }}
          >
            <KeyRound size={15} />
          </button>
        )}
      </div>
      <div className="shrink-0 border-b border-slate-100 px-3 pb-3 pt-2 dark:border-slate-800">
        <div className="mb-2 flex min-w-0 items-center gap-1">
          <button
            className={iconButton}
            title={ft(lang, "back")}
            disabled={!b.canBack || b.busy}
            onClick={b.back}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            className={iconButton}
            title={ft(lang, "up")}
            disabled={!b.listing || b.busy}
            onClick={() =>
              b.listing && void b.navigate(parentPath(b.listing.path))
            }
          >
            <ArrowUp size={15} />
          </button>
          <button
            className={iconButton}
            title={ft(lang, "home")}
            disabled={!b.listing || b.busy}
            onClick={() => void b.navigate("~")}
          >
            <Home size={15} />
          </button>
          <button
            className={iconButton}
            title={ft(lang, "refresh")}
            disabled={!b.listing || b.busy}
            onClick={b.refresh}
          >
            <RefreshCw size={14} className={b.busy ? "animate-spin" : ""} />
          </button>
          <div className="flex-1" />
          {!props.hostId && b.listing && (
            <select
              aria-label={ft(lang, "browse")}
              className="max-w-20 rounded-md bg-slate-50 px-1 py-1 text-xs dark:bg-slate-900"
              value={
                b.listing.roots.find((r) =>
                  b.listing!.path.toLowerCase().startsWith(r.toLowerCase()),
                ) || ""
              }
              onChange={(e) => void b.navigate(e.target.value)}
            >
              <option value="" disabled>
                —
              </option>
              {b.listing.roots.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
          <button
            className={cn(
              iconButton,
              "w-auto gap-1.5 px-2 text-[11px]",
              hidden &&
                "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300",
            )}
            title={ft(lang, "hidden")}
            aria-label={ft(lang, "hidden")}
            aria-pressed={hidden}
            onClick={() => {
              setHidden((v) => !v);
              if (scroller.current) scroller.current.scrollTop = 0;
            }}
          >
            {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
            <span>{ft(lang, "hiddenFiles")}</span>
          </button>
        </div>
        <button
          className="flex h-9 w-full min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left transition hover:border-blue-300 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-blue-700"
          title={b.listing?.path || ft(lang, "chooseDirectory")}
          aria-label={ft(lang, "chooseDirectory")}
          disabled={!b.listing || b.busy}
          onClick={() => setDirectoryPickerOpen(true)}
        >
          <FolderOpen size={14} className="shrink-0 text-slate-400" />
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600 dark:text-slate-300"
            dir="rtl"
          >
            {b.listing?.path || ft(lang, "disconnected")}
          </span>
          <ChevronDown size={13} className="shrink-0 text-slate-400" />
        </button>
        <div className="mt-2 flex items-center gap-2 px-1 text-slate-400">
          <Search size={13} />
          <input
            className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
            aria-label={ft(lang, "filter")}
            placeholder={ft(lang, "filter")}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              if (scroller.current) scroller.current.scrollTop = 0;
            }}
          />
        </div>
      </div>
      {b.error && (
        <div className="shrink-0 border-b border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-300">
          <p className="max-h-24 overflow-auto whitespace-pre-wrap break-words">
            {b.error}
          </p>
          {!!props.hostId && !b.busy && (
            <button
              onClick={() => setPasswordOpen(true)}
              className="mt-2 flex items-center gap-1 font-semibold underline"
            >
              <KeyRound size={13} />
              {ft(lang, "passwordLogin")} / {ft(lang, "uploadKey")}
            </button>
          )}
          {/host identification has changed|host key verification failed/i.test(
            b.error,
          ) &&
            props.hostId && (
              <button
                onClick={() => void showTrust()}
                className="mt-2 flex items-center gap-1 font-semibold underline"
              >
                <ShieldAlert size={13} />
                {ft(lang, "trustTitle")}
              </button>
            )}
        </div>
      )}
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_64px] items-center border-b border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-400 dark:border-slate-800 dark:bg-slate-900/30 2xl:grid-cols-[minmax(0,1fr)_64px_106px]">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label={ft(lang, "selectAll")}
            checked={allSelected}
            disabled={!canSelect.length}
            onChange={() =>
              setSelected(
                allSelected
                  ? new Map()
                  : new Map(canSelect.map((r) => [r.entry.path, r.entry])),
              )
            }
            className="h-3.5 w-3.5 rounded accent-blue-600"
          />
          <button
            className="flex items-center gap-1"
            onClick={() => sortBy("name")}
          >
            {ft(lang, "name")}
            {sort === "name" && <span>{descending ? "↓" : "↑"}</span>}
          </button>
        </span>
        <button className="text-right" onClick={() => sortBy("size")}>
          {ft(lang, "size")}
          {sort === "size" && (descending ? " ↓" : " ↑")}
        </button>
        <button
          className="hidden text-right 2xl:block"
          onClick={() => sortBy("modified")}
        >
          {ft(lang, "modified")}
          {sort === "modified" && (descending ? " ↓" : " ↑")}
        </button>
      </div>
      <div
        ref={scroller}
        className={cn(
          "relative min-h-[64px] flex-1 overflow-auto outline-none",
          dropPath === b.listing?.path &&
            "bg-blue-50/60 ring-2 ring-inset ring-blue-400 dark:bg-blue-950/20",
        )}
        onScroll={(e) => {
          // React clears currentTarget after dispatch; state updaters may run later.
          const top = e.currentTarget.scrollTop;
          setViewport((v) => ({ ...v, top }));
        }}
        onDragOver={(e) => b.listing && dragOver(e, b.listing.path)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDropPath(null);
        }}
        onDrop={(e) => b.listing && drop(e, b.listing.path)}
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "a") {
            e.preventDefault();
            setSelected(new Map(canSelect.map((r) => [r.entry.path, r.entry])));
          }
          if (e.key === "Escape") setSelected(new Map());
          if (e.key === "Backspace" && b.listing) {
            e.preventDefault();
            void b.navigate(parentPath(b.listing.path));
          }
        }}
      >
        {b.listing ? (
          rows.length ? (
            <div
              style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}
            >
              <div
                style={{
                  position: "absolute",
                  top: start * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                }}
              >
                {rows.slice(start, end).map(({ entry: e, depth }) => (
                  <div
                    key={e.path}
                    draggable={!e.isLink && (e.isDir || e.isFile)}
                    onDragStart={(ev) => dragStart(ev, e)}
                    onDragEnd={() => setDropPath(null)}
                    onDragOver={(ev) =>
                      e.isDir && !e.isLink && dragOver(ev, e.path)
                    }
                    onDrop={(ev) => e.isDir && !e.isLink && drop(ev, e.path)}
                    onClick={(ev) => {
                      if (ev.detail <= 1)
                        choose(e, ev.ctrlKey || ev.metaKey, ev.shiftKey);
                    }}
                    onDoubleClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      if (e.isDir && !e.isLink && !b.busy)
                        void b.navigate(e.path);
                    }}
                    title={`${e.path}${e.isLink ? ` — ${ft(lang, "link")}` : ""}`}
                    className={cn(
                      "grid cursor-default select-none grid-cols-[minmax(0,1fr)_64px] items-center border-b border-slate-100/60 px-3 text-xs transition-colors dark:border-slate-800/30 2xl:grid-cols-[minmax(0,1fr)_64px_106px]",
                      selected.has(e.path)
                        ? "bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200"
                        : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900",
                      dropPath === e.path &&
                        "bg-blue-100 ring-1 ring-inset ring-blue-400 dark:bg-blue-950",
                      (e.isLink || (!e.isFile && !e.isDir)) && "opacity-50",
                    )}
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        tabIndex={-1}
                        checked={selected.has(e.path)}
                        disabled={e.isLink || (!e.isFile && !e.isDir)}
                        aria-label={`${ft(lang, "select")} ${e.name}`}
                        className="h-3.5 w-3.5 shrink-0 accent-blue-600"
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={() => choose(e, true)}
                      />
                      <span
                        className="flex min-w-0 items-center gap-1"
                        style={{ paddingLeft: Math.min(depth, 6) * 13 }}
                      >
                        {e.isDir && !e.isLink ? (
                          <button
                            tabIndex={-1}
                            className="flex h-6 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:text-blue-500"
                            title={ft(
                              lang,
                              expanded.has(e.path) ? "collapse" : "expand",
                            )}
                            onDoubleClick={(ev) => ev.stopPropagation()}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void toggle(e);
                            }}
                          >
                            {loadingPaths.has(e.path) ? (
                              <LoaderCircle
                                size={12}
                                className="animate-spin"
                              />
                            ) : expanded.has(e.path) ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                          </button>
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}
                        {e.isLink ? (
                          <Link2 size={15} className="shrink-0" />
                        ) : e.isDir ? (
                          expanded.has(e.path) ? (
                            <FolderOpen
                              size={16}
                              className="shrink-0 text-amber-500"
                            />
                          ) : (
                            <Folder
                              size={16}
                              className="shrink-0 text-amber-500"
                            />
                          )
                        ) : (
                          <File size={15} className="shrink-0 text-slate-400" />
                        )}
                        <span className="truncate">{e.name}</span>
                      </span>
                    </span>
                    <span className="text-right text-[11px] tabular-nums text-slate-400">
                      {e.isDir ? "—" : bytes(e.size)}
                    </span>
                    <span className="hidden text-right text-[10px] tabular-nums text-slate-400 2xl:block">
                      {e.modified
                        ? new Date(e.modified * 1000).toLocaleDateString(lang)
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-slate-400">
              <FolderOpen size={30} strokeWidth={1} />
              <span className="text-xs">
                {ft(lang, filter ? "noMatch" : "empty")}
              </span>
            </div>
          )
        ) : (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-slate-400">
            {b.busy ? (
              <LoaderCircle
                size={30}
                strokeWidth={1.5}
                className="animate-spin text-blue-400"
              />
            ) : (
              <FolderOpen size={36} strokeWidth={1} />
            )}
            <p className="text-xs leading-6">
              {ft(lang, b.busy ? "connecting" : "ready")}
            </p>
            {!b.busy && (
              <Button
                variant="secondary"
                className="h-8 text-xs"
                onClick={() => void b.connect()}
              >
                {ft(lang, "connect")}
              </Button>
            )}
          </div>
        )}
        {b.busy && b.listing && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/65 backdrop-blur-[1px] dark:bg-slate-950/65">
            <span className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-500 shadow-sm dark:bg-slate-900">
              <LoaderCircle size={14} className="animate-spin" />
              {ft(lang, "loading")}
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-[11px] text-slate-400">
          {selected.size
            ? `${ft(lang, "selected")} ${selected.size} ${ft(lang, "items")}`
            : `${rootEntries?.length || 0} ${ft(lang, "items")}`}
        </span>
        {props.footer}
      </div>
      {directoryPickerOpen && b.listing && (
        <DirectoryPicker
          key={b.listing.sessionId}
          language={lang}
          hostId={props.hostId}
          hostName={host?.name || host?.sshHost || ft(lang, "local")}
          listing={b.listing}
          onClose={closeDirectoryPicker}
          onChoose={(path) => {
            setDirectoryPickerOpen(false);
            void b.navigate(path);
          }}
        />
      )}
      {passwordOpen && host && (
        <FileAuthentication
          key={host.id}
          host={host}
          language={lang}
          onClose={() => {
            setPasswordOpen(false);
          }}
          onConnect={(value) => {
            setPasswordOpen(false);
            void b.connect(value);
          }}
        />
      )}
      {trustOpen && (
        <ModalOverlay className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-950">
            <h3 className="font-semibold">{ft(lang, "trustTitle")}</h3>
            <p className="mt-2 text-sm text-slate-400">
              {ft(lang, "trustHint")}
            </p>
            <pre className="my-4 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-100 p-3 text-xs dark:bg-slate-900">
              {trustBusy
                ? ft(lang, "loading")
                : fingerprint || ft(lang, "fingerprintUnavailable")}
            </pre>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTrustOpen(false)}>
                {ft(lang, "cancel")}
              </Button>
              <Button
                disabled={trustBusy || !fingerprint}
                onClick={async () => {
                  setTrustBusy(true);
                  try {
                    await api.removeKnownHost(props.hostId);
                    setTrustOpen(false);
                    await b.connect();
                  } catch (e) {
                    b.setError(String(e));
                  } finally {
                    setTrustBusy(false);
                  }
                }}
              >
                {ft(lang, "trust")}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
