/*
 * Audit of another heavy screen: right-click a cell of a grid journal (opens the
 * cell menu, its state lives in the journal's root component) and close it with
 * Escape. Event Timing duration, plus DOM size and the biggest style recalc.
 *
 *   PATHNAME=/journals/hygiene/documents/<id> CPU=1 node .agent/tasks/staff-dialog-lag-2026-11-23/raw/measure-journal-menu.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "perf-staff-owner@example.test";
const PASSWORD = process.env.PASSWORD || "perf-pass-2026";
const CPU = Number(process.env.CPU || 1);
const PATHNAME = process.env.PATHNAME;
const RUNS = Number(process.env.RUNS || 3);

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

(async () => {
  if (!PATHNAME) throw new Error("PATHNAME is required");
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "ru-RU" });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.press("#password", "Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
  await page.goto(`${BASE}${PATHNAME}`, { waitUntil: "networkidle", timeout: 120000 });
  // Table view on every width (the journal can open as cards).
  await page.waitForSelector("[data-paint-cell]", { timeout: 60000 });
  const domNodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  await page.evaluate(() => {
    window.__eventEntries = [];
    new PerformanceObserver((list) => window.__eventEntries.push(...list.getEntries())).observe({
      type: "event",
      durationThreshold: 16,
    });
  });
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  const read = async () => {
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const entries = window.__eventEntries.splice(0);
      return entries.length ? Math.round(Math.max(...entries.map((e) => e.duration))) : 0;
    });
  };
  const open = [];
  const close = [];
  let maxStyleElements = 0;
  for (let run = 0; run <= RUNS; run++) {
    const cell = page.locator("[data-paint-cell]").nth(5 + run);
    await cell.scrollIntoViewIfNeeded();
    const box = await cell.boundingBox();
    await page.evaluate(() => (window.__eventEntries = []));
    if (run === RUNS) await browser.startTracing(page, { categories: ["devtools.timeline"] });
    // Tap changes the mark; the cell menu opens on right click.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await page.locator('[role="menu"]').first().waitFor({ state: "visible", timeout: 30000 });
    const opened = await read();
    await page.evaluate(() => (window.__eventEntries = []));
    await page.keyboard.press("Escape");
    await page.locator('[role="menu"]').first().waitFor({ state: "detached", timeout: 30000 });
    const closed = await read();
    if (run === RUNS) {
      const trace = JSON.parse((await browser.stopTracing()).toString("utf8")).traceEvents;
      maxStyleElements = Math.max(
        0,
        ...trace.filter((e) => e.name === "UpdateLayoutTree" && e.args?.elementCount).map((e) => e.args.elementCount),
      );
      continue;
    }
    if (run === 0) continue;
    open.push(opened);
    close.push(closed);
  }
  console.log(
    JSON.stringify({ path: PATHNAME, cpuThrottle: CPU, domNodes, menuOpenMs: median(open), menuCloseMs: median(close), open, close, maxStyleElements }),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
