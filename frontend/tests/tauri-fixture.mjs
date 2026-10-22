// Simulated IPC only: the real App and file-transfer components run in the browser.
export function installTauriFixture() {
  localStorage.clear();
  localStorage.setItem("sshdeck.file.right", "");
  const hosts = ["ready", "refused", "password", "slow"].map((id) => ({
    id,
    name: `Remote ${id}`,
    sshHost: "127.0.0.1",
    sshPort: "1",
    sshUser: "test",
    identityFile: "",
    extraOptions: "",
    proxyJump: "",
    forwards: [],
    pinned: false,
  }));
  const callbacks = new Map();
  const listeners = new Map();
  const sessions = new Map();
  const keys = new Set();
  let sequence = 0;
  const fixture = (window.fixture = {
    requests: [],
    closed: [],
    breakNextListing: false,
    setupNeedsPassword: false,
    setupFailure: "",
    directAlreadyReady: false,
    uploaded: [],
    emit(event, payload) {
      for (const [id, listener] of listeners) {
        if (listener.event === event)
          callbacks.get(listener.handler)?.({ event, id, payload });
      }
    },
  });
  function listing(sessionId, path) {
    const remote = !!sessions.get(sessionId);
    const nested = path.endsWith("Projects");
    const entry = (name, isDir = false) => ({
      name,
      path: `${path}${remote ? "/" : "\\"}${name}`,
      isDir,
      isFile: !isDir,
      isLink: false,
      size: isDir ? 0 : 5,
      modified: 0,
    });
    const entries = nested
      ? [entry("README.md")]
      : [
          entry("Projects", true),
          ...Array.from({ length: 250 }, (_, i) => entry(`file${i}.txt`)),
        ];
    if (fixture.breakNextListing) {
      fixture.breakNextListing = false;
      entries[0].name = null; // Fault injection exercises the UI error boundary.
    }
    return { sessionId, path, roots: remote ? ["/"] : ["C:\\"], entries };
  }
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback(fn) {
      const id = ++sequence;
      callbacks.set(id, fn);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    async invoke(command, args = {}) {
      fixture.requests.push({ command, ...args });
      switch (command) {
        case "list_hosts":
          return hosts;
        case "get_settings":
          return {
            theme: "light",
            language: "zh-CN",
            logLevel: "info",
            closeBehavior: "ask",
            autoUpdate: false,
            updateChannel: "preview",
          };
        case "list_logs":
        case "list_history":
        case "list_file_transfers":
          return [];
        case "check_ssh":
          return true;
        case "plugin:app|version":
          return "0.4.0-beta.6";
        case "plugin:event|listen": {
          const id = ++sequence;
          listeners.set(id, args);
          return id;
        }
        case "plugin:event|unlisten":
          listeners.delete(args.eventId);
          return;
        case "open_file_session": {
          await new Promise((resolve) =>
            setTimeout(resolve, args.hostId === "slow" ? 300 : 20),
          );
          if (args.hostId === "refused") throw "Connection refused";
          if (
            args.hostId === "password" &&
            !args.password &&
            !keys.has(args.hostId)
          )
            throw "Permission denied (publickey,password)";
          const id = `${args.hostId || "local"}-${++sequence}`;
          sessions.set(id, args.hostId || "");
          return listing(
            id,
            args.hostId ? `/srv/${args.hostId}` : "C:\\Regression",
          );
        }
        case "close_file_session":
          fixture.closed.push(args.sessionId);
          sessions.delete(args.sessionId);
          return;
        case "upload_public_key":
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (args.hostId === "ready" || keys.has(args.hostId))
            return hosts.find((host) => host.id === args.hostId);
          if (args.password !== "correct")
            throw "Upload public key failed: Permission denied";
          keys.add(args.hostId);
          fixture.uploaded.push(args.hostId);
          return hosts.find((host) => host.id === args.hostId);
        case "setup_direct_access":
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (fixture.setupFailure) throw fixture.setupFailure;
          if (fixture.directAlreadyReady)
            return { ready: true, passwordFor: null, alreadyReady: true };
          if (fixture.setupNeedsPassword && args.targetPassword !== "correct")
            return { ready: false, passwordFor: "target" };
          return { ready: true, passwordFor: null };
        case "vscode_open_path":
          return {
            addedToConfig: false,
            alias: "test",
            uri: "vscode-remote://test",
          };
        case "vscode_status":
          return { installed: true, remoteSsh: true };
        case "list_files":
          return listing(args.sessionId, args.path);
        default:
          return null;
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
}
