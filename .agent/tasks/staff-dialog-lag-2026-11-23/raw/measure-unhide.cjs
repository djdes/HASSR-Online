/*
 * The one-off cost of bringing the timesheet back (content-visibility: hidden →
 * visible) when the person scrolls down to it: the longest main-thread task
 * during a wheel scroll from the top of /settings/users to the timesheet.
 *
 *   BASE=http://localhost:3001 CPU=1 node .agent/tasks/staff-dialog-lag-2026-11-23/raw/measure-unhide.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.env.BASE || "http://localhost:3001";
const CPU = Number(process.env.CPU || 1);

(async () => {
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "ru-RU" });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", process.env.EMAIL || "perf-staff-owner@example.test");
  await page.fill("#password", process.env.PASSWORD || "perf-pass-2026");
  await page.press("#password", "Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
  await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 120000 });
  // Render it once (scroll to it), then go back up: it is hidden again.
  await page.locator("[data-print-landscape]").first().scrollIntoViewIfNeeded();
  await page.waitForSelector("[data-print-schedule]").catch(() => null);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => document.querySelector("[data-offscreen]")?.getAttribute("data-offscreen") ?? "none");
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((list) => window.__long.push(...list.getEntries().map((e) => Math.round(e.duration)))).observe({ type: "longtask" });
  });
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.mouse.move(960, 600);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1500);
  const longTasks = await page.evaluate(() => window.__long);
  console.log(JSON.stringify({ base: BASE, cpuThrottle: CPU, stateAtTop: state, longTasksMs: longTasks, longest: Math.max(0, ...longTasks) }));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
