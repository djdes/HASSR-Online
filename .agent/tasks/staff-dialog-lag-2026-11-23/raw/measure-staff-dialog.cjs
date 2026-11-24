/*
 * Measures how long «Изменить» (open) and «Отмена» (close) take on /settings/users
 * as the person feels it: the Event Timing API duration of the click — from the
 * press to the next painted frame (the same number INP reports).
 *
 *   BASE=http://localhost:3000 CPU=4 RUNS=5 node .agent/tasks/staff-dialog-lag-2026-11-23/raw/measure-staff-dialog.cjs
 *
 * CPU — Chrome CPU throttling (1 = this machine, 4 = a typical office laptop).
 * TRACE=path — also write a DevTools trace of one open+close and print its breakdown.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "perf-staff-owner@example.test";
const PASSWORD = process.env.PASSWORD || "perf-pass-2026";
const CPU = Number(process.env.CPU || 1);
const RUNS = Number(process.env.RUNS || 5);
const TRACE = process.env.TRACE || "";
const PATHNAME = process.env.PATHNAME || "/settings/users";

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

async function interactionDuration(page) {
  // Event Timing entries are queued after the frame is painted — give them time.
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const entries = window.__eventEntries.splice(0);
    const relevant = entries.filter((e) => ["pointerdown", "pointerup", "mousedown", "mouseup", "click"].includes(e.name));
    return relevant.length ? Math.max(...relevant.map((e) => e.duration)) : 0;
  });
}

async function clickAt(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box");
  await page.evaluate(() => (window.__eventEntries = []));
  const started = Date.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return started;
}

(async () => {
  // The repo pins its own Playwright; the machine has one Chromium — use it when present.
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
  await page.waitForSelector('button[aria-label="Редактировать сотрудника"]', { timeout: 60000 });
  // Before the fix the timesheet is in the server HTML; after it, it renders only near the screen.
  await page.waitForSelector("[data-print-schedule]", { timeout: 3000 }).catch(() => null);
  const timesheetInDom = await page.evaluate(() => Boolean(document.querySelector("[data-print-schedule]")));

  // Diagnostics only (EXPERIMENT=...): what the delay is made of.
  //   no-has       — delete every CSS rule with :has()
  //   no-body-has  — delete only rules whose :has() hangs on body / html / :root
  //   no-grid      — drop the timesheet table from the DOM
  //   cv-auto      — content-visibility: auto on the timesheet wrapper
  //   cv-hidden    — content-visibility: hidden on it (what a far-offscreen switch would do)
  const EXPERIMENT = process.env.EXPERIMENT || "";
  if (EXPERIMENT) {
    const removed = await page.evaluate((mode) => {
      let count = 0;
      const anchored = /(^|[\s,(])(body|html|:root)[^\s,{]*:has\(|(body|html|:root)[^\s,{]*:is\([^)]*:has\(/;
      const shouldDrop = (selector) =>
        mode === "no-has" ? selector.includes(":has(") : mode === "no-body-has" ? anchored.test(selector) : false;
      const walk = (list) => {
        for (let i = list.cssRules.length - 1; i >= 0; i--) {
          const rule = list.cssRules[i];
          if (rule.cssRules && !rule.selectorText) walk(rule);
          else if (rule.selectorText && shouldDrop(rule.selectorText)) {
            list.deleteRule(i);
            count++;
          }
        }
      };
      if (mode === "cv-auto" || mode === "cv-hidden") {
        const wrapper = document.querySelector("[data-print-schedule]")?.parentElement;
        if (wrapper) {
          wrapper.style.contentVisibility = mode === "cv-auto" ? "auto" : "hidden";
          wrapper.style.containIntrinsicSize = "auto 3000px";
          count = 1;
        }
      } else if (mode === "no-grid") {
        const table = document.querySelector("[data-print-schedule]");
        if (table) {
          count = table.getElementsByTagName("*").length;
          table.remove();
        }
      } else {
        for (const sheet of document.styleSheets) {
          try {
            walk(sheet);
          } catch {
            /* cross-origin sheet */
          }
        }
      }
      return count;
    }, EXPERIMENT);
    console.error(`experiment ${EXPERIMENT}: removed ${removed}`);
  }
  const domNodes = await page.evaluate(() => document.getElementsByTagName("*").length);

  await page.evaluate(() => {
    window.__eventEntries = [];
    new PerformanceObserver((list) => window.__eventEntries.push(...list.getEntries())).observe({
      type: "event",
      durationThreshold: 16,
      buffered: false,
    });
  });

  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  const edit = page.locator('button[aria-label="Редактировать сотрудника"]').first();
  const results = { open: [], close: [], openWall: [], closeWall: [] };
  for (let run = 0; run < RUNS + 1; run++) {
    const tracing = TRACE && run === RUNS;
    if (tracing) {
      await browser.startTracing(page, {
        path: TRACE,
        categories: [
          "devtools.timeline",
          "disabled-by-default-devtools.timeline",
          "blink.user_timing",
          "v8.execute",
          ...(process.env.INVALIDATIONS ? ["disabled-by-default-devtools.timeline.invalidationTracking"] : []),
        ],
      });
    }
    let started = await clickAt(page, edit);
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 60000 });
    const openWall = Date.now() - started;
    const open = await interactionDuration(page);

    const cancel = dialog.getByRole("button", { name: "Отмена", exact: true });
    started = await clickAt(page, cancel);
    await dialog.waitFor({ state: "detached", timeout: 60000 });
    const closeWall = Date.now() - started;
    const close = await interactionDuration(page);
    if (tracing) await browser.stopTracing();
    // The first round warms up code paths and caches; it is not counted.
    if (run === 0 || tracing) continue;
    results.open.push(Math.round(open));
    results.close.push(Math.round(close));
    results.openWall.push(openWall);
    results.closeWall.push(closeWall);
  }

  const summary = {
    base: BASE,
    path: PATHNAME,
    cpuThrottle: CPU,
    runs: RUNS,
    domNodes,
    timesheetInDom,
    openMs: { median: median(results.open), all: results.open },
    closeMs: { median: median(results.close), all: results.close },
    openWallMs: { median: median(results.openWall), all: results.openWall },
    closeWallMs: { median: median(results.closeWall), all: results.closeWall },
  };

  if (TRACE) {
    const trace = JSON.parse(fs.readFileSync(TRACE, "utf8"));
    const events = trace.traceEvents || trace;
    const buckets = {
      scripting: ["FunctionCall", "EventDispatch", "TimerFire", "FireAnimationFrame", "RunMicrotasks", "V8.Execute"],
      style: ["UpdateLayoutTree", "RecalculateStyles"],
      layout: ["Layout"],
      paint: ["Paint", "PrePaint", "Layerize", "UpdateLayer", "CompositeLayers", "RasterTask"],
    };
    const totals = { scripting: 0, style: 0, layout: 0, paint: 0 };
    // Only main-thread top-level slices of the renderer.
    const mainThreads = new Set(
      events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`)
    );
    for (const e of events) {
      if (e.ph !== "X" || !mainThreads.has(`${e.pid}:${e.tid}`)) continue;
      for (const [bucket, names] of Object.entries(buckets)) {
        if (names.includes(e.name)) totals[bucket] += (e.dur || 0) / 1000;
      }
    }
    summary.traceBreakdownMs = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)]));
  }

  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
