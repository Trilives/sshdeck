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
async function rapidScroll(page) {
  await page
    .locator('[tabindex="0"]')
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
      const pane = filter.locator("xpath=../../..");
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
          localStorage.setItem(
            `sshdeck.file.recent.${host || "local"}`,
            JSON.stringify(
              [hiddenVisit, visibleVisit].map((path) => ({
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
