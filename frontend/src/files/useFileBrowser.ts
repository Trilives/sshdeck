import { useCallback, useEffect, useRef, useState } from "react";
import { filesApi } from "./api";
import type { FileListing } from "./types";
import { recordFolderVisit } from "./folderHistory";

function remembered(host: string) {
  try {
    return localStorage.getItem(`sshdeck.file.path.${host || "local"}`) || "";
  } catch {
    return "";
  }
}
function remember(host: string, path: string) {
  try {
    localStorage.setItem(`sshdeck.file.path.${host || "local"}`, path);
  } catch {
    /* private storage */
  }
}

export function useFileBrowser(hostId: string, enabled: boolean) {
  const [listing, setListing] = useState<FileListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const navigation = useRef(0);
  const session = useRef("");
  const history = useRef<string[]>([]);
  const currentPath = useRef("");

  const disconnect = useCallback(() => {
    ++generation.current;
    ++navigation.current;
    const old = session.current;
    session.current = "";
    setListing(null);
    setBusy(false);
    setError("");
    history.current = [];
    currentPath.current = "";
    if (old) void filesApi.close(old).catch(() => {});
  }, []);

  const connect = useCallback(
    async (password?: string) => {
      disconnect();
      const version = ++generation.current;
      setBusy(true);
      setError("");
      let opened = "";
      try {
        let result = await filesApi.open(hostId, password);
        opened = result.sessionId;
        const saved = remembered(hostId);
        if (saved && saved !== result.path) {
          try {
            result = await filesApi.list(opened, saved);
          } catch {
            /* start at home if remembered folder was removed */
          }
        }
        if (generation.current !== version) {
          void filesApi.close(opened).catch(() => {});
          return;
        }
        session.current = opened;
        recordFolderVisit(hostId, result.path);
        currentPath.current = result.path;
        setListing(result);
        setRevision((v) => v + 1);
      } catch (e) {
        if (opened) void filesApi.close(opened).catch(() => {});
        if (generation.current === version) setError(String(e));
      } finally {
        if (generation.current === version) setBusy(false);
      }
    },
    [hostId, disconnect],
  );

  useEffect(() => {
    if (!enabled) return;
    void connect();
    return disconnect;
  }, [enabled, connect, disconnect]);

  const navigate = useCallback(
    async (path: string, back = false) => {
      const sid = session.current;
      if (!sid) return;
      const version = generation.current;
      const nav = ++navigation.current;
      setBusy(true);
      setError("");
      try {
        const result = await filesApi.list(sid, path);
        if (generation.current !== version || navigation.current !== nav)
          return;
        if (!back && currentPath.current && result.path !== currentPath.current)
          history.current.push(currentPath.current);
        currentPath.current = result.path;
        remember(hostId, result.path);
        recordFolderVisit(hostId, result.path);
        setListing(result);
        setRevision((v) => v + 1);
      } catch (e) {
        if (generation.current === version && navigation.current === nav)
          setError(String(e));
      } finally {
        if (generation.current === version && navigation.current === nav)
          setBusy(false);
      }
    },
    [hostId],
  );
  const back = () => {
    const previous = history.current.pop();
    if (previous) void navigate(previous, true);
  };
  const refresh = useCallback(() => {
    if (currentPath.current) void navigate(currentPath.current);
  }, [navigate]);
  return {
    listing,
    busy,
    error,
    setError,
    revision,
    connect,
    disconnect,
    navigate,
    back,
    canBack: history.current.length > 0,
    refresh,
  };
}
export type FileBrowser = ReturnType<typeof useFileBrowser>;
