/*
 * Latency of ordinary clicks on /settings/users (Event Timing duration, ms):
 * a staff-row checkbox, the search box (one key), a timesheet cell (paint + save),
 * and the «Пн» chip of the first timesheet row. Plus the biggest style recalc
 * (elements) each click caused, from a DevTools trace.
 *
 *   BASE=http://localhost:3000 CPU=1 node .agent/tasks/staff-dialog-lag-2026-11-23/raw/measure-staff-clicks.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "perf-staff-owner@example.test";
const PASSWORD = process.env.PASSWORD || "perf-pass-2026";
const CPU = Number(process.env.CPU || 1);

async function timed(page, browser, action) {
  await page.evaluate(() => (window.__eventEntries = []));
  await browser.startTracing(page, { categories: ["devtools.timeline"] });
  await action();
  await page.waitForTimeout(700);
  const buffer = await browser.stopTracing();
  const events = JSON.parse(buffer.toString("utf8")).traceEvents;
  const styles = events.filter((e) => e.name === "UpdateLayoutTree" && e.ph === "X" && e.args?.elementCount);
  const maxElements = Math.max(0, ...styles.map((e) => e.args.elementCount));
  const duration = await page.evaluate(() => {
    const entries = window.__eventEntries.splice(0);
    return entries.length ? Math.round(Math.max(...entries.map((e) => e.duration))) : 0;
  });
  return { ms: duration, maxStyleElements: maxElements };
}

async function clickCenter(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

(async () => {
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "ru-RU" });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.press("#password", "Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
  await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector('button[aria-label="Редактировать сотрудника"]', { timeout: 60000 });
  await page.evaluate(() => {
    window.__eventEntries = [];
    new PerformanceObserver((list) => window.__eventEntries.push(...list.getEntries())).observe({
      type: "event",
      durationThreshold: 16,
    });
  });
  // Diagnostics only: EXPERIMENT=no-pseudo-has drops rules with :active/:focus inside :has()
  // (the motion layer), EXPERIMENT=no-has drops every :has() rule.
  const EXPERIMENT = process.env.EXPERIMENT || "";
  if (EXPERIMENT) {
    const removed = await page.evaluate((mode) => {
      let count = 0;
      const drop = (raw) => {
        const s = raw.replace(/"/g, "");
        if (!s.includes(":has(")) return false;
        return mode === "no-has" || /:has\([^{]*:(active|focus)/.test(s);
      };
      const walk = (list) => {
        for (let i = list.cssRules.length - 1; i >= 0; i--) {
          const rule = list.cssRules[i];
          if (rule.cssRules && !rule.selectorText) walk(rule);
          else if (rule.selectorText && drop(rule.selectorText)) {
            list.deleteRule(i);
            count++;
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          walk(sheet);
        } catch {
          /* cross-origin */
        }
      }
      return count;
    }, EXPERIMENT);
    console.error(`experiment ${EXPERIMENT}: removed ${removed}`);
  }
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  const results = {};
  const checkbox = page.locator('label input[type="checkbox"]').first();
  await clickCenter(page, checkbox); // warm-up
  await clickCenter(page, checkbox);
  results.staffCheckbox = await timed(page, browser, () => clickCenter(page, checkbox));
  await clickCenter(page, checkbox);

  const search = page.locator('input[type="search"]').first();
  await search.click();
  results.searchKey = await timed(page, browser, () => page.keyboard.press("a"));
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(500);

  // The timesheet renders when it comes near the screen (after the fix): scroll to it first.
  await page.locator("[data-print-landscape]").first().scrollIntoViewIfNeeded();
  await page.waitForSelector("[data-print-schedule]", { timeout: 30000 });
  await page.waitForTimeout(500);
  const cell = page.locator("[data-workoff-cell]").nth(40);
  results.timesheetCell = await timed(page, browser, () => clickCenter(page, cell));
  await page.waitForTimeout(1500);

  const chip = page.locator('[data-print-schedule] tbody tr').first().locator('[role="group"] button').first();
  results.weekdayChip = await timed(page, browser, () => clickCenter(page, chip));
  await page.waitForTimeout(1500);
  // Put the chip back so reruns start from the same data.
  await clickCenter(page, chip);
  await page.waitForTimeout(1500);

  console.log(JSON.stringify({ base: BASE, cpuThrottle: CPU, ...results }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
