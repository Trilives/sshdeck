import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { installTauriFixture } from "./tauri-fixture.mjs";

let server, browser, baseUrl;
before(async () => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vite/bin/vite.js", import.meta.url),
      ),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      windowsHide: true,
      stdio: "ignore",
    },
  );
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(baseUrl)).ok) break;
    } catch {}
    if (Date.now() >= deadline) throw new Error("Vite did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
});
after(async () => {
  await browser?.close();
  server?.kill();
});

async function withPage(run) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(installTauriFixture);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "文件传输", exact: true }).click();
    await page.getByTitle("C:\\Regression", { exact: true }).first().waitFor();
    await run(page, errors);
  } finally {
    await context.close();
  }
}
async function chooseHost(page, id) {
  await page.locator("button[aria-expanded]").first().click();
  await page
    .getByRole("button", {
      name: id ? `Remote ${id} 127.0.0.1` : "本机",
      exact: true,
    })
    .click();
}

test("the sidebar centers its navigation and remembers the dragged width", () =>
  withPage(async (page, errors) => {
    await page.setViewportSize({ width: 980, height: 640 });
    const sidebar = page.getByRole("navigation");
    const divider = page.getByRole("separator", { name: "调整侧栏宽度" });
    const menu = await sidebar.boundingBox();
    const settings = await sidebar.getByRole("button", { name: "设置", exact: true }).boundingBox();
    const guide = await sidebar.getByRole("button", { name: "使用说明", exact: true }).boundingBox();
    assert.equal(await sidebar.getByRole("button").count(), 7);
    assert.equal(settings.x, guide.x);
    assert.ok(settings.y + settings.height < guide.y);
    assert.equal(menu.y + menu.height / 2, 320);
    const home = sidebar.getByRole("button", { name: "主页", exact: true });
    assert.equal(await home.evaluate((button) => getComputedStyle(button).fontSize), "14px");
    assert.equal(await divider.getAttribute("aria-valuenow"), "232");
    assert.equal(await divider.locator("*").count(), 0);

    const { x, y, width } = await divider.boundingBox();
    const edge = x + width / 2;
    await page.mouse.move(edge, y + 275);
    await page.mouse.down();
    await page.mouse.move(edge + 36, y + 275, { steps: 5 });
    await page.mouse.up();
    await divider.and(page.locator('[aria-valuenow="268"]')).waitFor();
    await page.reload();
    await divider.and(page.locator('[aria-valuenow="268"]')).waitFor();

    await divider.focus();
    await page.keyboard.press("Home");
    await divider.and(page.locator('[aria-valuenow="192"]')).waitFor();
    await sidebar.getByRole("button", { name: "使用说明", exact: true }).click();
    await page.getByRole("heading", { name: "使用说明", level: 1 }).waitFor();
    assert.deepEqual(errors, []);
  }));

test("long dashboard events keep the cards and connection actions within the window", () =>
  withPage(async (page, errors) => {
    await page.setViewportSize({ width: 980, height: 640 });
    const message = "[Remote ready/Web] exited with code 255: " +
      "channel 1: open failed: connect failed: ".repeat(20) +
      "x".repeat(300);
    await page.evaluate((message) => {
      const { hosts, logs } = window.fixture;
      hosts[0].pinned = true;
      hosts[0].forwards = [{
        id: "dashboard-forward",
        name: "Web",
        mode: "local",
        status: "running",
        bindDisplay: "127.0.0.1:18000",
        targetDisplay: "127.0.0.1:8000",
      }];
      logs.push({ level: "warning", timestamp: "2026-11-26 15:41:52", message });
    }, message);
    await page.getByRole("button", { name: "主页", exact: true }).click();
    const dashboard = page.locator("main > div > section");
    const event = dashboard.getByText(message, { exact: true });
    await event.waitFor();
    const dimensions = await dashboard.evaluate((element) => ({
      available: element.clientWidth,
      content: element.scrollWidth,
      right: element.getBoundingClientRect().left + element.clientWidth,
    }));
    assert.equal(dimensions.content, dimensions.available, "the dashboard must not scroll horizontally");
    assert.equal(await event.getAttribute("title"), message, "the full log is available on hover");
    for (const name of ["新建", "全部断开", "在浏览器打开", "断开", "远程连接"]) {
      const action = await dashboard.getByRole("button", { name, exact: true }).boundingBox();
      assert.ok(action && action.x + action.width <= dimensions.right, name + " must fit in the dashboard");
    }
    assert.deepEqual(errors, []);
  }));

test("the dashboard remote connection dialog keeps long paths and their actions in view", () =>
  withPage(async (page, errors) => {
    await page.setViewportSize({ width: 980, height: 640 });
    const path = "/srv/projects/" + "long-remote-directory/".repeat(28) + "assets/";
    const medium = "/srv/projects/design-system/releases/0.4.5/frontend";
    await page.evaluate(({ path, medium }) => {
      window.fixture.hosts[0].pinned = true;
      window.fixture.hosts[0].name = "Remote ready " + "H".repeat(160);
      const labels = [path, medium, ...Array.from({ length: 10 }, (_, index) => "/home/test/older-" + index)];
      window.fixture.history.ready = labels.map((label, index) => ({
        id: "remote-directory-" + index,
        hostId: "ready",
        kind: "vscode",
        label,
        uri: "",
        detail: "",
        openedAt: 0,
      }));
    }, { path, medium });
    await page.getByRole("button", { name: "主页", exact: true }).click();
    const dashboard = page.locator("main > div > section");
    await dashboard.getByRole("button", { name: "远程连接", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^远程连接 — Remote ready/ });
    const fullPath = dialog.getByText(path, { exact: true });
    await fullPath.waitFor();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.width === 512 && bounds.x >= 0 && bounds.x + bounds.width <= 980);
    assert.ok(await dialog.getByText(medium, { exact: true }).evaluate((element) =>
      [...element.children].every((part) => part.scrollWidth <= part.clientWidth)));
    assert.ok(await fullPath.evaluate((element) => {
      const [prefix, suffix] = element.children;
      return prefix.scrollWidth > prefix.clientWidth &&
        suffix.scrollWidth <= suffix.clientWidth &&
        suffix.textContent === "/assets/";
    }), "the path can shorten in the middle while the final directory remains visible");

    const close = await dialog.getByRole("button", { name: "关闭", exact: true }).boundingBox();
    assert.ok(close && close.x + close.width <= bounds.x + bounds.width);
    const row = fullPath.locator("xpath=ancestor::button[1]/..");
    for (const label of ["通过 VS Code 打开", "填入下方目录框（可继续编辑）"]) {
      const action = row.getByRole("button", { name: label, exact: true });
      const button = await action.boundingBox();
      assert.ok(button && button.x >= bounds.x && button.x + button.width <= bounds.x + bounds.width,
        label + " must stay inside the dialog");
      assert.equal((await action.textContent()).trim(), "", "row actions use icon-only buttons");
    }
    const footerVscode = dialog.getByRole("button", { name: "VS Code", exact: true });
    const footerBounds = await footerVscode.boundingBox();
    assert.ok(footerBounds && footerBounds.y + footerBounds.height <= bounds.y + bounds.height);
    const list = row.locator("..");
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.ok(await list.evaluate((element) => element.scrollTop > 0));
    assert.deepEqual(await footerVscode.boundingBox(), footerBounds);
    await page.setViewportSize({ width: 500, height: 540 });
    const narrow = await dialog.boundingBox();
    assert.ok(narrow && narrow.width < 512 && narrow.x >= 0 && narrow.x + narrow.width <= 500);
    await list.evaluate((element) => { element.scrollTop = 0; });
    await row.getByRole("button", { name: "填入下方目录框（可继续编辑）", exact: true }).click();
    assert.equal(await dialog.getByRole("textbox").inputValue(), path);
    await row.getByRole("button", { name: "通过 VS Code 打开", exact: true }).click();
    await page.waitForFunction((expectedPath) => window.fixture.requests.some(
      (request) => request.command === "vscode_open_path" && request.path === expectedPath,
    ), path);
    assert.deepEqual(errors, []);
  }));

test("the dashboard plus menu opens each workflow on its sidebar page", () =>
  withPage(async (page, errors) => {
    await page.setViewportSize({ width: 980, height: 640 });
    const home = page.getByRole("button", { name: "主页", exact: true });
    const plus = page.getByRole("button", { name: "新建", exact: true });
    const menu = plus.locator("..");
    await home.click();
    const connectionCard = plus.locator("xpath=ancestor::section[1]");
    assert.deepEqual(await connectionCard.evaluate((card) => {
      const style = getComputedStyle(card);
      return [style.zIndex, style.backdropFilter];
    }), ["auto", "none"], "the menu can float without raising the connection card's shadow");
    assert.equal(await plus.textContent(), "", "the create button shows only its icon");
    await plus.press("Enter");
    assert.equal(await plus.getAttribute("aria-expanded"), "true");
    await menu.getByRole("button", { name: "端口转发", exact: true }).press("Escape");
    assert.equal(await plus.getAttribute("aria-expanded"), "false");
    assert.ok(await plus.evaluate((button) => button === document.activeElement));

    await plus.click();
    await menu.getByRole("button", { name: "新建主机", exact: true }).click();
    await page.getByRole("heading", { name: "远程连接", exact: true }).waitFor();
    const hostDialog = page.getByRole("dialog", { name: "新建主机", exact: true });
    await hostDialog.getByRole("button", { name: "取消", exact: true }).click();

    await page.evaluate(() => {
      const hosts = window.fixture.hosts;
      const target = hosts.pop();
      const fillers = Array.from({ length: 12 }, (_, index) => ({
        ...hosts[0], id: "filler-" + index, name: "Filler " + index,
      }));
      target.forwards = [{
        id: "saved-forward",
        name: "已有转发",
        mode: "local",
        status: "stopped",
        bindDisplay: "127.0.0.1:18000",
        targetDisplay: "127.0.0.1:8000",
      }];
      hosts.push(...fillers, target);
    });
    await home.click();
    await plus.click();
    await menu.getByRole("button", { name: "端口转发", exact: true }).click();
    await page.getByRole("heading", { name: "端口转发管理", exact: true }).waitFor();
    const picker = page.getByRole("dialog", { name: "选择转发主机", exact: true });
    await picker.getByRole("button", { name: /^Filler 11 / }).waitFor();
    await picker.getByRole("textbox", { name: "搜索主机名称或地址" }).fill("Remote slow");
    const choices = picker.getByRole("button", { name: /^Remote / });
    assert.equal(await choices.count(), 1);
    await choices.first().click();
    await picker.waitFor({ state: "hidden" });
    const card = page.locator("#forwarding-host-slow");
    await card.getByText("已有转发", { exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.closest("#forwarding-host-slow"));
    const scrolled = await page.locator("main > div > section").evaluate((element) => element.scrollTop);
    assert.ok(scrolled > 0, "the selected host is scrolled into view");
    await card.getByRole("button", { name: "新建端口转发", exact: true }).click();
    await page.getByRole("heading", { name: "端口转发", exact: true }).waitFor();

    const mode = page.getByRole("combobox", { name: "模式", exact: true });
    const address = page.getByRole("textbox", { name: /^本机地址/ });
    const port = page.getByRole("textbox", { name: /^本机端口/ });
    const target = page.getByRole("textbox", { name: /^远端地址/ });
    const targetPort = page.getByRole("textbox", { name: /^远程端口/ });
    for (const value of ["local", "remote", "dynamic"]) {
      await mode.selectOption(value);
      const pairs = [[page.getByRole("textbox", { name: "名称", exact: true }), mode], [address, port]];
      if (value === "dynamic") {
        assert.equal(await target.count(), 0);
      } else {
        pairs.push([target, targetPort]);
      }
      for (const [left, right] of pairs) {
        const [leftBounds, rightBounds] = await Promise.all([left.boundingBox(), right.boundingBox()]);
        assert.ok(leftBounds && rightBounds && leftBounds.y === rightBounds.y,
          value + " fields must align even when their hints wrap differently");
      }
    }
    assert.deepEqual(errors, []);
  }));

test("the dashboard forwarding shortcut offers to add the first host", () =>
  withPage(async (page, errors) => {
    await page.evaluate(() => window.fixture.hosts.splice(0));
    await page.getByRole("button", { name: "主页", exact: true }).click();
    const plus = page.getByRole("button", { name: "新建", exact: true });
    await plus.click();
    await plus.locator("..").getByRole("button", { name: "端口转发", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "选择转发主机", exact: true });
    await picker.getByRole("button", { name: "新建主机", exact: true }).click();
    await page.getByRole("dialog", { name: "新建主机", exact: true }).waitFor();
    await page.getByRole("heading", { name: "远程连接", exact: true }).waitFor();
    assert.equal(await picker.count(), 0);
    assert.deepEqual(errors, []);
  }));

test("appearance saves independently and system mode responds to live changes", () =>
  withPage(async (page, errors) => {
    const settings = page.getByRole("button", { name: "设置", exact: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await settings.click();
    assert.equal(await page.getByRole("radio", { name: "浅色", exact: true }).isChecked(), true);
    assert.equal(await page.getByRole("radio", { name: "蓝色", exact: true }).isChecked(), true);
    assert.equal(await page.locator("html").evaluate((root) => root.classList.contains("dark")), false);

    await page.getByText("跟随系统", { exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));

    for (const [label, accent, background] of [
      ["紫色", "violet", "rgb(124, 58, 237)"],
      ["深橙", "orange", "rgb(166, 54, 13)"],
      ["青绿", "teal", "rgb(20, 100, 94)"],
      ["朴素", "monochrome", "rgb(23, 23, 23)"],
    ]) {
      await page.getByText(label, { exact: true }).click();
      await page.getByRole("radio", { name: label, exact: true, checked: true }).waitFor();
      await page.waitForFunction(({ accent, background }) => {
        const active = document.querySelector("aside nav .bg-blue-600");
        return document.documentElement.dataset.accent === accent &&
          active && getComputedStyle(active).backgroundColor === background;
      }, { accent, background });
    }

    await page.reload();
    await settings.click();
    await page.getByRole("radio", { name: "朴素", exact: true, checked: true }).waitFor();
    assert.equal(await page.getByRole("radio", { name: "跟随系统", exact: true }).isChecked(), true);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => {
      const active = document.querySelector("aside nav [aria-current='page']");
      return document.documentElement.classList.contains("dark") &&
        active && getComputedStyle(active).backgroundColor === "rgb(82, 82, 82)";
    });
    await page.getByText("深色", { exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await page.locator("html").evaluate((root) => root.classList.contains("dark")), true);
    assert.equal(await page.getByRole("radio", { name: "朴素", exact: true }).isChecked(), true);
    assert.deepEqual(errors, []);
  }));

test("launch at login is opt-in and the settings page reloads its state", () =>
  withPage(async (page) => {
    const settings = page.getByRole("button", { name: "设置", exact: true });
    await settings.click();
    const startup = page.getByRole("switch", { name: "开机自启", exact: true });
    await page.waitForFunction(() => !document.querySelector('[aria-label="开机自启"]')?.disabled);
    assert.equal(await startup.isChecked(), false);
    await startup.press("Space");
    await page.waitForFunction(() => document.querySelector('[aria-label="开机自启"]')?.checked);
    await page.getByRole("button", { name: "远程连接", exact: true }).click();
    await settings.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="开机自启"]')?.checked);
    await startup.press("Space");
    await page.waitForFunction(() => !document.querySelector('[aria-label="开机自启"]')?.checked);
    const changes = await page.evaluate(() => window.fixture.requests.filter((entry) => entry.command === "set_launch_at_login").map((entry) => entry.enabled));
    assert.deepEqual(changes, [true, false]);
  }));

test("long-press reorders hosts in both pages and automatic mode hides the handles", () =>
  withPage(async (page, errors) => {
    const remote = page.getByRole("button", { name: "远程连接", exact: true });
    await remote.click();
    const handles = page.getByRole("button", { name: /^调整 Remote/ });
    assert.equal(await handles.first().evaluate((handle) => handle.previousElementSibling?.getAttribute("aria-label")), "置顶");
    const ready = await handles.nth(0).boundingBox();
    const password = await handles.nth(2).boundingBox();
    assert.ok(ready && password);
    await page.mouse.move(ready.x + ready.width / 2, ready.y + ready.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('[aria-label="调整 Remote ready 的顺序"]')?.getAttribute("aria-pressed") === "true");
    await page.mouse.move(password.x + password.width / 2, password.y + password.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('button[aria-label^="调整 Remote"]')?.getAttribute("aria-label") === "调整 Remote refused 的顺序");
    assert.deepEqual(await handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), [
      "调整 Remote refused 的顺序", "调整 Remote password 的顺序", "调整 Remote ready 的顺序", "调整 Remote slow 的顺序",
    ]);
    // dnd-kit briefly suppresses document clicks after pointer release.
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "端口转发", exact: true }).click();
    await page.getByRole("heading", { name: "端口转发管理", exact: true }).waitFor();
    assert.equal(await handles.first().getAttribute("aria-label"), "调整 Remote refused 的顺序");
    assert.equal(await handles.first().evaluate((handle) => handle.previousElementSibling?.getAttribute("aria-label")), "置顶");

    const settings = page.getByRole("button", { name: "设置", exact: true });
    await settings.click();
    const autoSort = page.getByRole("switch", { name: "自动排序主机", exact: true });
    assert.equal(await autoSort.isChecked(), false);
    await autoSort.press("Space");
    await page.waitForFunction(() => document.querySelector('[aria-label="自动排序主机"]')?.checked);
    await remote.click();
    assert.equal(await handles.count(), 0);
    await settings.click();
    await autoSort.press("Space");
    await page.waitForFunction(() => !document.querySelector('[aria-label="自动排序主机"]')?.checked);
    await remote.click();
    assert.equal(await handles.first().getAttribute("aria-label"), "调整 Remote refused 的顺序");
    assert.deepEqual(errors, []);
  }));
test("the guide follows the same task order in both languages and adapts to the window", () =>
  withPage(async (page) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.getByRole("button", { name: "使用说明", exact: true }).click();
    const headings = page.locator("main > div > section").locator("h1:visible, h2:visible");
    const chineseOrder = [
      "使用说明",
      "快速开始",
      "主机配置与认证",
      "远程连接",
      "文件传输",
      "端口转发",
      "主页、日志与排错",
      "设置与更新",
    ];
    await headings.first().waitFor();
    assert.deepEqual(await headings.allTextContents(), chineseOrder);
    const cards = chineseOrder.slice(2).map(
      (name) => page.getByRole("heading", { name, exact: true }).locator("xpath=../.."),
    );
    const cardBoxes = () => Promise.all(cards.map((card) => card.boundingBox()));
    const wide = await cardBoxes();
    assert.ok(wide.every(Boolean));
    assert.ok(wide[0].x < wide[1].x, "host setup and remote usage are side by side");
    assert.ok(wide[2].width > wide[0].width, "the file transfer module spans the page");
    for (const card of cards) {
      const bottomSpace = await card.evaluate((element) =>
        element.getBoundingClientRect().bottom - element.lastElementChild.getBoundingClientRect().bottom,
      );
      assert.ok(bottomSpace <= 22, `card should end below its content, got ${bottomSpace}px of space`);
    }

    await page.setViewportSize({ width: 980, height: 640 });
    const narrow = await cardBoxes();
    assert.ok(narrow.every(Boolean));
    assert.equal(new Set(narrow.map((box) => box.x)).size, 1);
    assert.ok(narrow.every((box, index) => index === 0 || box.y >= narrow[index - 1].y + narrow[index - 1].height));

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.locator("select").filter({ has: page.locator('option[value="en-US"]') }).selectOption("en-US");
    const remoteLabel = page.getByRole("navigation").getByRole("button", { name: "Remote Connections", exact: true }).locator("span");
    assert.ok(await remoteLabel.evaluate((label) => label.scrollWidth <= label.clientWidth));
    await page.getByRole("button", { name: "Guide", exact: true }).click();
    await headings.first().waitFor();
    assert.deepEqual(await headings.allTextContents(), [
      "Guide",
      "Quick start",
      "Hosts and authentication",
      "Remote Connections",
      "File Transfer",
      "Port Forwarding",
      "Home, logs, and troubleshooting",
      "Settings and updates",
    ]);
    const example = page.getByRole("heading", { name: "Local forwarding example for a remote website" }).locator("..");
    assert.deepEqual(await example.locator("dt").allTextContents(), [
      "Mode", "Local Address", "Local Port", "Remote Address", "Remote Port",
    ]);
    assert.deepEqual(await example.locator("dd").allTextContents(), [
      "local", "127.0.0.1", "18000", "127.0.0.1", "8000",
    ]);
  }));

async function rapidScroll(page) {
  await page
    .locator('main > div > section div[tabindex="0"]')
    .first()
    .evaluate((element) => {
      // Two events in one frame make React defer a functional state updater.
      for (const top of [1500, 1600]) {
        element.scrollTop = top;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    });
}

async function openLongRemotePage(page) {
  await page.getByRole("button", { name: "远程连接", exact: true }).click();
  for (const id of ["ready", "refused", "password", "slow"]) {
    await page
      .getByRole("button", { name: new RegExp(`^Remote ${id} test@`) })
      .click();
  }
  const scroller = page.locator("main > div > section");
  assert.ok(
    await scroller.evaluate((el) => el.scrollHeight > el.clientHeight * 1.5),
  );
  return scroller;
}

async function assertInViewport(page, locator) {
  const rect = await locator.boundingBox();
  assert.ok(rect, "dialog content is rendered");
  const viewport = page.viewportSize();
  assert.ok(
    rect.x >= 0 &&
      rect.y >= 0 &&
      rect.x + rect.width <= viewport.width + 1 &&
      rect.y + rect.height <= viewport.height + 1,
    `content must fit in viewport: ${JSON.stringify(rect)} / ${JSON.stringify(viewport)}`,
  );
  return rect;
}

test("directory modal stays centered in the window on a long scrolled page", () =>
  withPage(async (page, errors) => {
    const scroller = await openLongRemotePage(page);
    await page
      .getByRole("button", { name: "选择目录", exact: true })
      .last()
      .click();
    const confirm = page
      .getByRole("dialog", { name: /选择目录/ })
      .getByRole("button", {
        name: "VS Code",
        exact: true,
      });
    await confirm.waitFor();
    assert.ok(
      await scroller.evaluate((el) => el.scrollTop > 0),
      "underlying page is scrolled",
    );
    const dialog = page.getByRole("dialog", { name: /选择目录/ });
    for (const height of [800, 640]) {
      await page.setViewportSize({ width: 1280, height });
      const rect = await assertInViewport(page, dialog);
      assert.ok(
        Math.abs(rect.y + rect.height / 2 - height / 2) < 2,
        "dialog is vertically centered in the window",
      );
      await assertInViewport(page, confirm);
    }
    await page
      .getByRole("button", { name: "手动输入路径", exact: true })
      .click();
    await assertInViewport(page, confirm);
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await assertInViewport(page, dialog);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.deepEqual(errors, []);
  }));

test("long forms and stacked password dialogs fit a small window in dark mode", () =>
  withPage(async (page, errors) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await openLongRemotePage(page);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page
      .getByRole("button", { name: "编辑主机", exact: true })
      .last()
      .click();
    const form = page.locator("[data-modal-overlay] > *").last();
    const rect = await assertInViewport(page, form);
    assert.ok(Math.abs(rect.y + rect.height / 2 - 320) < 2);
    assert.equal(
      await form.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(2, 6, 23)",
    );
    const save = page.getByRole("button", { name: "保存", exact: true });
    await save.scrollIntoViewIfNeeded();
    await assertInViewport(page, save);
    await page.getByRole("button", { name: "取消", exact: true }).click();

    const passwordHost = page
      .getByRole("button", { name: /^Remote password test@/ })
      .locator("..")
      .locator("..");
    await passwordHost
      .getByRole("button", { name: "选择目录", exact: true })
      .click();
    const input = page.locator('input[type="password"]');
    await input.waitFor();
    await assertInViewport(page, input);
    assert.equal(await page.locator("[data-modal-overlay]").count(), 2);
    const passwordDialog = page.locator("[data-modal-overlay] > *").last();
    const passwordRect = await assertInViewport(page, passwordDialog);
    assert.ok(Math.abs(passwordRect.y + passwordRect.height / 2 - 320) < 2);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .locator("[data-modal-overlay]")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    assert.deepEqual(errors, []);
  }));

test("scrolling then switching hosts keeps the page mounted", () =>
  withPage(async (page, errors) => {
    await rapidScroll(page);
    await chooseHost(page, "ready");
    await page.getByTitle("/srv/ready", { exact: true }).waitFor();
    await rapidScroll(page);
    await chooseHost(page, "");
    await page.getByTitle("C:\\Regression", { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
  }));

test("connection failures stay inside the pane and allow changing host", () =>
  withPage(async (page, errors) => {
    await chooseHost(page, "refused");
    await page.getByText("Connection refused", { exact: true }).waitFor();
    await chooseHost(page, "ready");
    await page.getByTitle("/srv/ready", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  }));

test("password login failure shows a usable dialog", () =>
  withPage(async (page, errors) => {
    await chooseHost(page, "password");
    await page.locator('input[type="password"]').waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await chooseHost(page, "");
    await page.getByTitle("C:\\Regression", { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
  }));

test("remote folder picker launches Terminal and VS Code at the selected directory", () =>
  withPage(async (page, errors) => {
    await openLongRemotePage(page);
    const host = page
      .getByRole("button", { name: /^Remote ready test@/ })
      .locator("..")
      .locator("..");
    for (const [button, command] of [
      ["终端", "open_terminal"],
      ["VS Code", "vscode_open_path"],
    ]) {
      await host.getByRole("button", { name: "选择目录", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: /选择目录/ });
      await dialog
        .getByRole("button", { name: "手动输入路径", exact: true })
        .click();
      await dialog
        .getByRole("textbox", { name: "输入路径，按 Enter 跳转", exact: true })
        .fill("/srv/ready/Projects");
      await dialog.getByRole("button", { name: "定位", exact: true }).click();
      await page.waitForFunction(() =>
        window.fixture.requests.some(
          (r) => r.command === "list_files" && r.path === "/srv/ready/Projects",
        ),
      );
      assert.equal(
        await dialog
          .getByRole("button", { name: "使用此目录", exact: true })
          .count(),
        0,
      );
      await dialog.getByRole("button", { name: button, exact: true }).click();
      await page.waitForFunction(
        (cmd) =>
          window.fixture.requests.some(
            (r) =>
              r.command === cmd &&
              r.path === "/srv/ready/Projects" &&
              r.hostId === "ready",
          ),
        command,
      );
      if (command === "open_terminal") {
        await host.getByText("/srv/ready/Projects", { exact: true }).waitFor();
      }
      assert.equal(
        await page.getByRole("dialog", { name: /选择目录/ }).count(),
        0,
      );
    }
    assert.deepEqual(errors, []);
  }));

test("file authentication supports one-time password and key upload with retry", () =>
  withPage(async (page, errors) => {
    await chooseHost(page, "ready");
    await page.getByTitle("/srv/ready", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "连接认证", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "上传密钥并连接", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "连接认证", exact: true })
      .waitFor({ state: "hidden" });
    assert.deepEqual(
      await page.evaluate(() => window.fixture.uploaded),
      [],
      "working passwordless access skips upload without asking for a password",
    );
    await chooseHost(page, "password");
    const auth = page.getByRole("dialog", { name: "连接认证", exact: true });
    await auth
      .getByRole("button", { name: "使用密码连接", exact: true })
      .waitFor();
    await auth.locator('input[type="password"]').fill("correct");
    await auth
      .getByRole("button", { name: "使用密码连接", exact: true })
      .click();
    await page.getByTitle("/srv/password", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "连接认证", exact: true })
      .first()
      .click();
    await auth.locator('input[type="password"]').fill("wrong");
    await auth
      .getByRole("button", { name: "上传密钥并连接", exact: true })
      .click();
    await auth.getByRole("alert").waitFor();
    assert.equal(await auth.locator('input[type="password"]').inputValue(), "");
    await auth.locator('input[type="password"]').fill("correct");
    await auth
      .getByRole("button", { name: "上传密钥并连接", exact: true })
      .click();
    await auth.waitFor({ state: "hidden" });
    await page.getByTitle("/srv/password", { exact: true }).waitFor();
    const last = await page.evaluate(() =>
      window.fixture.requests
        .filter(
          (r) => r.command === "open_file_session" && r.hostId === "password",
        )
        .at(-1),
    );
    assert.equal(
      last.password,
      null,
      "reconnect after upload must use key authentication",
    );
    assert.deepEqual(errors, []);
  }));

test("direct access setup prompts for the correct recipient and allows retry", () =>
  withPage(async (page, errors) => {
    await chooseHost(page, "ready");
    await page.getByTitle("/srv/ready", { exact: true }).waitFor();
    await page.locator("button[aria-expanded]").nth(1).click();
    await page
      .getByRole("button", { name: "Remote slow 127.0.0.1", exact: true })
      .click();
    await page.getByTitle("/srv/slow", { exact: true }).waitFor();
    await page.getByTitle("/srv/ready/file0.txt", { exact: true }).click();
    await page.getByRole("button", { name: "发送到右侧", exact: true }).click();
    await page.getByRole("button", { name: "不经过本机", exact: true }).click();
    await page.evaluate(() => {
      window.fixture.setupNeedsPassword = true;
    });
    await page
      .getByRole("button", { name: "配置直传密钥", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor();
    assert.ok(
      await page
        .getByRole("button", { name: "加入传输队列", exact: true })
        .isDisabled(),
    );
    await page
      .getByText("配置直传密钥 · Remote slow", { exact: true })
      .waitFor();
    await page.locator('input[type="password"]').fill("correct");
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page
      .getByRole("button", { name: "直传连接已验证", exact: true })
      .waitFor();
    assert.ok(
      await page
        .getByRole("button", { name: "加入传输队列", exact: true })
        .isEnabled(),
    );
    await page.evaluate(() => {
      window.fixture.setupFailure = "Connection refused";
    });
    await page
      .getByRole("button", { name: "直传连接已验证", exact: true })
      .click();
    await page
      .getByRole("alert")
      .getByText("Connection refused", { exact: true })
      .waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    const calls = await page.evaluate(() =>
      window.fixture.requests.filter(
        (r) => r.command === "setup_direct_access",
      ),
    );
    assert.equal(calls.length, 3);
    assert.equal(calls[1].targetPassword, "correct");
    assert.equal(calls[1].sourcePassword, null);
    assert.equal(
      calls[2].targetPassword,
      null,
      "credentials are cleared after setup",
    );
    await page.evaluate(() => {
      window.fixture.setupFailure = "";
      window.fixture.directAlreadyReady = true;
    });
    await page
      .getByRole("button", { name: "配置直传密钥", exact: true })
      .click();
    await page
      .getByRole("button", { name: "已免密，跳过上传", exact: true })
      .waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.deepEqual(errors, []);
  }));

test("distribution sets up direct access separately for each recipient", () =>
  withPage(async (page, errors) => {
    await chooseHost(page, "ready");
    await page.getByTitle("/srv/ready", { exact: true }).waitFor();
    await page.getByRole("button", { name: "分发模式", exact: true }).click();
    await page.getByRole("button", { name: /^选择接收主机/ }).click();
    for (const id of ["slow", "password"]) {
      await page
        .getByRole("checkbox", { name: `Remote ${id}`, exact: true })
        .check();
    }
    await page.locator('input[type="password"]').waitFor();
    await page.locator('input[type="password"]').fill("correct");
    await page
      .getByRole("button", { name: "使用密码连接", exact: true })
      .click();
    await page.getByTitle("/srv/password", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Remote slow /srv/slow", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByTitle("/srv/ready/file0.txt", { exact: true }).click();
    await page.getByRole("button", { name: "开始分发", exact: true }).click();
    await page.getByRole("button", { name: "不经过本机", exact: true }).click();
    for (let index = 0; index < 2; index++) {
      await page
        .getByRole("button", { name: "配置直传密钥", exact: true })
        .first()
        .click();
      await page.waitForFunction(
        (count) =>
          window.fixture.requests.filter(
            (r) => r.command === "setup_direct_access",
          ).length === count,
        index + 1,
      );
      await page.waitForFunction(
        (count) =>
          [...document.querySelectorAll("button")].filter((b) =>
            b.textContent.includes("直传连接已验证"),
          ).length === count,
        index + 1,
      );
    }
    const calls = await page.evaluate(() =>
      window.fixture.requests.filter(
        (r) => r.command === "setup_direct_access",
      ),
    );
    assert.ok(calls[0].targetSession.startsWith("slow-"));
    assert.ok(calls[1].targetSession.startsWith("password-"));
    assert.equal(calls[0].sourceSession, calls[1].sourceSession);
    assert.deepEqual(errors, []);
  }));

test("a late connection cannot replace the newly chosen host", () =>
  withPage(async (page, errors) => {
    await chooseHost(page, "slow");
    await chooseHost(page, "ready");
    await page.getByTitle("/srv/ready", { exact: true }).waitFor();
    await page.waitForFunction(() =>
      window.fixture.closed.some((id) => id.startsWith("slow-")),
    );
    assert.equal(
      await page.getByTitle("/srv/ready", { exact: true }).count(),
      1,
    );
    assert.deepEqual(errors, []);
  }));

test("both file panes put navigation above the list and filtering below it", () =>
  withPage(async (page) => {
    await chooseHost(page, "ready");
    await page.getByTitle("/srv/ready", { exact: true }).waitFor();
    const filters = page.getByRole("textbox", { name: "筛选当前目录", exact: true });
    assert.equal(await filters.count(), 2);
    for (const [index, path] of ["/srv/ready", "C:\\Regression"].entries()) {
      const filter = filters.nth(index);
      const pane = filter.locator("xpath=../..");
      const controls = [
        pane.getByTitle(path, { exact: true }),
        pane.getByTitle("后退", { exact: true }),
        pane.getByRole("checkbox", { name: "全选当前目录", exact: true }),
        pane.locator('div[tabindex="0"]'),
        filter,
        pane.getByRole("button", { name: index === 0 ? "发送到右侧" : "发送到左侧", exact: true }),
      ];
      let bottom = 0;
      for (const control of controls) {
        const box = await control.boundingBox();
        assert.ok(box && box.y >= bottom, "file pane controls are in the expected vertical order");
        bottom = box.y + box.height;
      }
    }
  }));

test("local and remote panes hide dotfiles by default and can show, select and browse them", () =>
  withPage(async (page, errors) => {
    for (const host of ["", "ready"]) {
      if (host) await chooseHost(page, host);
      const root = host ? "/srv/ready" : "C:\\Regression";
      const separator = host ? "/" : "\\";
      await page.getByTitle(root, { exact: true }).first().waitFor();
      const toggle = page
        .getByRole("button", { name: "显示隐藏文件", exact: true })
        .first();
      const filter = page
        .getByRole("textbox", { name: "筛选当前目录", exact: true })
        .first();
      const pane = filter.locator("xpath=../..");
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      await filter.fill(".env");
      const file = pane.getByTitle(`${root}${separator}.env`, { exact: true });
      assert.equal(await file.count(), 0);
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-pressed"), "true");
      await file.waitFor();
      await file.getByRole("checkbox").check();
      assert.ok(await file.getByRole("checkbox").isChecked());
      await toggle.click();
      await file.waitFor({ state: "hidden" });
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      await toggle.click();
      await file.waitFor();
      await filter.fill("");
      await pane
        .getByTitle(`${root}${separator}.config`, { exact: true })
        .dblclick();
      await pane
        .getByTitle(`${root}${separator}.config${separator}.credentials`, {
          exact: true,
        })
        .waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
      await toggle.click();
    }
    assert.deepEqual(errors, []);
  }));

test("directory pickers default to hiding dotfolders in the tree and history", () =>
  withPage(async (page, errors) => {
    for (const host of ["", "ready"]) {
      if (host) await chooseHost(page, host);
      const root = host ? "/srv/ready" : "C:\\Regression";
      const separator = host ? "/" : "\\";
      const hiddenPath = `${root}${separator}.config`;
      const hiddenVisit = `${hiddenPath}${separator}Projects`;
      const visibleVisit = `${root}${separator}Projects`;
      await page.evaluate(
        ({ host, hiddenVisit, visibleVisit }) => {
          window.fixture.transferFolders[host] = [hiddenVisit, visibleVisit];
          localStorage.setItem(
            `sshdeck.file.recent.${host || "local"}`,
            JSON.stringify(
              [`${visibleVisit}-only-browsed`].map((path) => ({
                path,
                visitedAt: Date.now(),
              })),
            ),
          );
        },
        { host, hiddenVisit, visibleVisit },
      );
      const open = page
        .getByRole("button", { name: "选择目录", exact: true })
        .first();
      await open.click();
      const dialog = page.getByRole("dialog", { name: /选择目录/ });
      const toggle = dialog.getByRole("button", {
        name: "显示隐藏文件",
        exact: true,
      });
      const folder = dialog.getByTitle(hiddenPath, { exact: true });
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      assert.equal(await folder.count(), 0);
      await toggle.click();
      await folder.waitFor();
      await toggle.click();
      await folder.waitFor({ state: "hidden" });
      await dialog.getByRole("tab", { name: "历史目录", exact: true }).click();
      await dialog.getByTitle(visibleVisit, { exact: true }).waitFor();
      assert.equal(await dialog.getByTitle(`${visibleVisit}-only-browsed`, { exact: true }).count(), 0);
      assert.equal(
        await dialog.getByTitle(hiddenVisit, { exact: true }).count(),
        0,
      );
      await toggle.click();
      await dialog.getByTitle(hiddenVisit, { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await open.click();
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      assert.equal(await folder.count(), 0);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "显示隐藏文件", exact: true })
          .first()
          .getAttribute("aria-pressed"),
        "false",
      );
    }
    assert.deepEqual(errors, []);
  }));

test("double-clicking a file only selects it; folders still navigate", () =>
  withPage(async (page, errors) => {
    const before = await page.evaluate(
      () =>
        window.fixture.requests.filter((r) => r.command === "list_files")
          .length,
    );
    await page
      .getByTitle("C:\\Regression\\file0.txt", { exact: true })
      .first()
      .dblclick();
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.requests.filter((r) => r.command === "list_files")
            .length,
      ),
      before,
    );
    await page
      .getByTitle("C:\\Regression\\Projects", { exact: true })
      .first()
      .dblclick();
    await page
      .getByTitle("C:\\Regression\\Projects", { exact: true })
      .first()
      .waitFor();
    await page.getByText("README.md", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  }));

test("a rendering failure preserves navigation and the close dialog", () =>
  withPage(async (page) => {
    await page.evaluate(() => {
      window.fixture.breakNextListing = true;
    });
    await page
      .getByRole("button", { name: "刷新", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "重新打开文件传输", exact: true })
      .waitFor();
    await page.evaluate(() => window.fixture.emit("close-requested", false));
    await page.getByRole("button", { name: "取消", exact: true }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("button", { name: "重新打开文件传输", exact: true })
      .click();
    await page.getByTitle("C:\\Regression", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "主页", exact: true }).click();
    await page
      .getByRole("heading", { name: "当前连接", exact: true })
      .waitFor();
  }));
