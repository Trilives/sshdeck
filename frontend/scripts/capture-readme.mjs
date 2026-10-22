// Render the actual application with public sample data; no SSH connections or
// user profiles are accessed. Run: node frontend/scripts/capture-readme.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

function installDemo({ language }) {
  localStorage.clear();
  localStorage.setItem("sshdeck.file.left", "");
  localStorage.setItem("sshdeck.file.right", "production");
  const date = Date.UTC(2026, 9, 22, 10);
  const forward = (id, name, port, targetPort, mode = "local") => ({
    id,
    name,
    mode,
    bindHost: "127.0.0.1",
    bindPort: port,
    targetHost: "127.0.0.1",
    targetPort,
    keepConnected: true,
    status: "running",
    bindDisplay: `127.0.0.1:${port}`,
    targetDisplay: mode === "dynamic" ? "SOCKS5" : `127.0.0.1:${targetPort}`,
  });
  const hosts = [
    {
      id: "production",
      name: "Production",
      sshHost: "203.0.113.10",
      sshUser: "deploy",
      pinned: true,
      forwards: [
        forward("web", "Web Dashboard", "8080", "8000"),
        forward("db", "PostgreSQL", "15432", "5432"),
      ],
    },
    {
      id: "development",
      name: "Development",
      sshHost: "192.0.2.20",
      sshUser: "developer",
      pinned: true,
      forwards: [forward("proxy", "SOCKS Proxy", "1080", "", "dynamic")],
    },
    {
      id: "backup",
      name: "Backup",
      sshHost: "198.51.100.30",
      sshUser: "backup",
      pinned: false,
      forwards: [],
    },
  ].map((host) => ({
    sshPort: "22",
    identityFile: "",
    extraOptions: "",
    proxyJump: "",
    ...host,
  }));
  const history = {
    production: ["/srv/sshdeck", "/opt/services/api", "/var/www/docs"],
    development: [
      "/home/developer/projects/sshdeck",
      "/home/developer/projects/dashboard",
    ],
    backup: ["/srv/backups"],
  };
  const histories = (hostId) =>
    (history[hostId] || []).map((path, index) => ({
      id: `${hostId}-${index}`,
      hostId,
      kind: "vscode",
      label: path,
      uri: `vscode-remote://ssh-remote+${hostId}${path}`,
      detail: "",
      openedAt: date - index * 3600000,
    }));
  const folders = {
    "/": ["bin/", "etc/", "home/", "opt/", "srv/", "usr/", "var/"],
    "/srv": ["backups/", "sshdeck/", "www/"],
    "/srv/sshdeck": [
      "config/",
      "docs/",
      "logs/",
      "releases/",
      "compose.yaml",
      "nginx.conf",
      "README.md",
      "release.tar.gz",
    ],
    "C:\\": ["Projects/", "Users/"],
    "C:\\Projects": ["dashboard/", "sshdeck/"],
    "C:\\Projects\\sshdeck": [
      "docs/",
      "public/",
      "src/",
      "src-tauri/",
      ".gitignore",
      "CHANGELOG.md",
      "package.json",
      "README.md",
      "release.tar.gz",
      "vite.config.ts",
    ],
  };
  const sessions = new Map();
  const callbacks = new Map();
  let sequence = 0;
  function listing(sessionId, path) {
    const remote = !!sessions.get(sessionId);
    const entries = (
      folders[path] || [
        "assets/",
        "guides/",
        "architecture.md",
        "getting-started.md",
      ]
    ).map((name, i) => {
      const isDir = name.endsWith("/");
      name = name.replace(/\/$/, "");
      return {
        name,
        path: `${path.replace(/[\\/]$/, "")}${remote ? "/" : "\\"}${name}`,
        isDir,
        isFile: !isDir,
        isLink: false,
        size: isDir ? 0 : name.endsWith(".gz") ? 268435456 : 2048 + i * 1703,
        modified: date / 1000 - i * 600,
      };
    });
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
      switch (command) {
        case "list_hosts":
          return hosts;
        case "get_settings":
          return {
            theme: "light",
            language,
            logLevel: "info",
            closeBehavior: "ask",
            autoUpdate: false,
            updateChannel: "stable",
          };
        case "plugin:app|version":
          return "0.4.0";
        case "check_ssh":
          return true;
        case "plugin:event|listen":
          return ++sequence;
        case "list_logs":
          return [];
        case "list_history":
          return args.hostId
            ? histories(args.hostId)
            : hosts.flatMap((h) => histories(h.id));
        case "open_file_session": {
          const id = `demo-${++sequence}`;
          sessions.set(id, args.hostId || "");
          return listing(
            id,
            args.hostId ? "/srv/sshdeck" : "C:\\Projects\\sshdeck",
          );
        }
        case "list_files":
          return listing(args.sessionId, args.path);
        case "close_file_session":
          sessions.delete(args.sessionId);
          return;
        case "list_file_transfers":
          return [
            {
              id: "completed",
              source: language === "zh-CN" ? "本机" : "This computer",
              target: "Production",
              destination: "/srv/sshdeck/docs",
              status: "completed",
              currentFile: "docs/getting-started.md",
              bytesDone: 65536,
              bytesTotal: 65536,
              filesDone: 3,
              filesTotal: 3,
              skipped: 0,
              speed: 0,
              direct: false,
              error: "",
            },
            {
              id: "running",
              source: language === "zh-CN" ? "本机" : "This computer",
              target: "Production",
              destination: "/srv/sshdeck/releases",
              status: "running",
              currentFile: "release.tar.gz",
              bytesDone: 155692564,
              bytesTotal: 268435456,
              filesDone: 0,
              filesTotal: 1,
              skipped: 0,
              speed: 12582912,
              direct: false,
              error: "",
            },
          ];
        default:
          return null;
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
}

const frontend = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(frontend, "../docs/Pictures");
await mkdir(output, { recursive: true });
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const server = spawn(
  process.execPath,
  [
    resolve(frontend, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: frontend, windowsHide: true, stdio: "ignore" },
);
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (attempt > 100) throw new Error("Vite did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
  for (const language of ["zh-CN", "en-US"]) {
    const zh = language === "zh-CN",
      suffix = zh ? "zh" : "en";
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
      locale: language,
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    });
    await context.addInitScript(installDemo, { language });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const button = (name) =>
      page.getByRole("button", { name, exact: true }).first();
    const capture = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(250);
      if (errors.length) throw new Error(errors.join("\n"));
      await page.screenshot({
        path: resolve(output, `${name}-${suffix}.png`),
        type: "png",
        animations: "disabled",
        scale: "device",
      });
      console.log(`${name}-${suffix}.png: 3200 × 2000`);
    };
    await page.goto(url);
    await button(zh ? "远程连接" : "Remote Connections").click();
    for (const host of ["Production"]) {
      await page.getByRole("button", { name: new RegExp(`^${host} `) }).click();
    }
    await page.getByText("/opt/services/api", { exact: true }).waitFor();
    await capture("remote");
    await button(zh ? "选择目录" : "Choose folder")
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /Production/ });
    await dialog
      .getByRole("button", { name: "VS Code", exact: true })
      .waitFor();
    await capture("folder-picker");
    await dialog
      .getByRole("button", { name: zh ? "取消" : "Cancel", exact: true })
      .click();
    await button(zh ? "文件传输" : "File Transfer").click();
    await page.getByTitle("/srv/sshdeck", { exact: true }).waitFor();
    await page
      .getByRole("checkbox", {
        name: `${zh ? "选择" : "Select"} src`,
        exact: true,
      })
      .check();
    await page
      .getByRole("checkbox", {
        name: `${zh ? "选择" : "Select"} README.md`,
        exact: true,
      })
      .first()
      .check();
    await page.getByText("release.tar.gz", { exact: true }).first().waitFor();
    await capture("file-transfer");
    await button(zh ? "端口转发" : "Port Forwarding").click();
    for (const host of ["Production", "Development"]) {
      await page.getByRole("button", { name: new RegExp(`^${host} `) }).click();
    }
    await page.getByText("PostgreSQL", { exact: true }).waitFor();
    await capture("port-forwarding");
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
