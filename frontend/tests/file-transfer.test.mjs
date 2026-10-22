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
