/*
 * Printing before the timesheet has ever been rendered (page at the top, short
 * window): Ctrl+P (`beforeprint`) and the page's «Печать» button must both put
 * the timesheet on the sheet.
 *
 *   BASE=http://localhost:3001 node .agent/tasks/staff-dialog-lag-2026-11-23/raw/verify-print-unmounted.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3001";

async function freshPage(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector('button[aria-label="Редактировать сотрудника"]');
  await page.waitForTimeout(1000);
  return page;
}

(async () => {
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  // A short window: the timesheet is more than a screen below the fold.
  const context = await browser.newContext({ viewport: { width: 1280, height: 500 }, locale: "ru-RU" });
  const login = await context.newPage();
  await login.goto(`${BASE}/login`);
  await login.fill("#email", process.env.EMAIL || "perf-staff-owner@example.test");
  await login.fill("#password", process.env.PASSWORD || "perf-pass-2026");
  await login.press("#password", "Enter");
  await login.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
  await login.close();

  const out = {};
  // 1. Ctrl+P: the browser fires beforeprint synchronously before laying out the sheet.
  {
    const page = await freshPage(context);
    out.mountedBeforePrint = await page.evaluate(() => Boolean(document.querySelector("[data-print-schedule]")));
    out.rowsAfterBeforePrint = await page.evaluate(() => {
      window.dispatchEvent(new Event("beforeprint"));
      // Synchronously, as the print engine would read it.
      return document.querySelectorAll("[data-print-schedule] tbody tr").length;
    });
    await page.close();
  }
  // 2. The page's own «Распечатать» button (in the app it prints natively, without beforeprint).
  {
    const page = await freshPage(context);
    await page.evaluate(() => {
      window.__printed = null;
      window.print = () => {
        window.__printed = document.querySelectorAll("[data-print-schedule] tbody tr").length;
      };
    });
    // The button sits above the timesheet; a click scrolls it into view, so take the
    // count the moment print() is called.
    await page.getByRole("button", { name: "Распечатать", exact: true }).click();
    await page.waitForTimeout(500);
    out.rowsWhenPrintButtonCalledPrint = await page.evaluate(() => window.__printed);
    await page.close();
  }
  console.log(JSON.stringify(out));
  assert.equal(out.mountedBeforePrint, false, "the timesheet is deferred at the top of a short window");
  assert.equal(out.rowsAfterBeforePrint, 117);
  assert.equal(out.rowsWhenPrintButtonCalledPrint, 117);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
