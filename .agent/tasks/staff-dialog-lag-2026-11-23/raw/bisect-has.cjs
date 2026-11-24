/*
 * Which global CSS rules turn a dialog opening into a whole-document style
 * recalculation? For each group of :has() rules: delete the group in a fresh
 * page, open «Изменить» under a trace and report the biggest style recalc
 * (elements) and how many "all descendants might be invalid" sets fired on <body>.
 *
 *   node .agent/tasks/staff-dialog-lag-2026-11-23/raw/bisect-has.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "perf-staff-owner@example.test";
const PASSWORD = process.env.PASSWORD || "perf-pass-2026";

const GROUPS = {
  none: null,
  "dark-theme :has(.app-shell[data-app-theme=dark])": ":has(.app-shell[data-app-theme=dark])",
  "new-design :not(:has([data-app-theme=dark],…))": ":has([data-app-theme=dark],[data-partner-accent],.mini-root)",
  "touch :has(.app-shell:not(…))": ":has(.app-shell:not(",
  "body:has(.app-shell)": "body:has(.app-shell)",
  ":has(>[aria-label=…])": ":has(>[aria-label",
  "focus/active :has(:focus…/:active)": "__pseudo__",
  "all :has": ":has(",
};

async function measure(context, needle) {
  const page = await context.newPage();
  await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector("[data-print-schedule]");
  const removed = await page.evaluate((needle) => {
    if (!needle) return 0;
    let count = 0;
    const match = (raw) => {
      const s = raw.replace(/"/g, "");
      return (
      needle === "__pseudo__" ? /:has\((:focus|:active|:where\(input|\+|>:is\()/.test(s) : s.includes(needle));
    };
    const walk = (list) => {
      for (let i = list.cssRules.length - 1; i >= 0; i--) {
        const rule = list.cssRules[i];
        if (rule.cssRules && !rule.selectorText) walk(rule);
        else if (rule.selectorText && match(rule.selectorText)) {
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
  }, needle);
  await page.waitForTimeout(500);
  const browser = context.browser();
  await browser.startTracing(page, {
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline.invalidationTracking"],
  });
  const edit = page.locator('button[aria-label="Редактировать сотрудника"]').first();
  await edit.click();
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
  await page.waitForTimeout(800);
  const buffer = await browser.stopTracing();
  const events = JSON.parse(buffer.toString("utf8")).traceEvents;
  const styles = events.filter((e) => e.name === "UpdateLayoutTree" && e.ph === "X" && e.args?.elementCount);
  const maxElements = Math.max(0, ...styles.map((e) => e.args.elementCount));
  const totalStyleMs = Math.round(styles.reduce((sum, e) => sum + e.dur, 0) / 1000);
  const wholeSubtree = events.filter(
    (e) =>
      e.name === "StyleInvalidatorInvalidationTracking" &&
      /^BODY/.test(e.args?.data?.nodeName || "") &&
      JSON.stringify(e.args?.data?.invalidationList || "").includes("allDescendantsMightBeInvalid"),
  ).length;
  const bodyRecalcReasons = {};
  for (const e of events) {
    const d = e.args?.data;
    if (e.name === "StyleRecalcInvalidationTracking" && /^(BODY|HTML)/.test(d?.nodeName || "") && d.subtree) {
      bodyRecalcReasons[d.reason] = (bodyRecalcReasons[d.reason] || 0) + 1;
    }
  }
  await page.close();
  return { removed, maxElements, totalStyleMs, wholeSubtree, bodyRecalcReasons };
}

(async () => {
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "ru-RU" });
  const login = await context.newPage();
  await login.goto(`${BASE}/login`);
  await login.fill("#email", EMAIL);
  await login.fill("#password", PASSWORD);
  await login.press("#password", "Enter");
  await login.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
  await login.close();
  for (const [name, needle] of Object.entries(GROUPS)) {
    const result = await measure(context, needle);
    console.log(JSON.stringify({ group: name, ...result }));
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
