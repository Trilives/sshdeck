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
    const confirm = page.getByRole("button", {
      name: "使用此目录",
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
