/*
 * Micro-benchmark of style invalidation on the real /settings/users DOM:
 * how long the forced style recalc takes after (a) a class change on one deep
 * element, (b) inserting one <div> into <body>, (c) an attribute on <body>.
 * Each CSS rule group is deleted in a fresh page to see who makes these
 * whole-document recalcs.
 *
 *   node .agent/tasks/staff-dialog-lag-2026-11-23/raw/bisect-style-cost.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "perf-staff-owner@example.test";
const PASSWORD = process.env.PASSWORD || "perf-pass-2026";
const PATHNAME = process.env.PATHNAME || "/settings/users";

const GROUPS = [
  ["none", null],
  ["all :has()", "s.includes(':has(')"],
  [":has() anchored on body", "/(^|[\\s,(])body[^\\s,{]*:(has|is)\\(/.test(s) && s.includes(':has(')"],
  [":has() anchored on html/:root", "/(^|[\\s,(])(html|:root)[^\\s,{]*:/.test(s) && s.includes(':has(')"],
  [":has() with [class*=]/[style*=] inside", "/:has\\([^{]*\\[(class|style)[*^$|~]?=/.test(s)"],
  [":has(:focus/:active/input…)", "/:has\\((:where\\(input|:is\\(button|:focus|:active|input,)/.test(s)"],
  ["dark theme body:is(…:has(.app-shell[data-app-theme=dark]))", "s.includes('.app-shell[data-app-theme=dark]')"],
  ["new design :not(:has([data-app-theme=dark]…))", "s.includes(':not(:has([data-app-theme=dark]')"],
];

async function run(context, predicate) {
  const page = await context.newPage();
  await page.goto(`${BASE}${PATHNAME}`, { waitUntil: "networkidle", timeout: 120000 });
  return page.evaluate((predicate) => {
    let removed = 0;
    if (predicate) {
      const test = new Function("s", `return ${predicate};`);
      const walk = (list) => {
        for (let i = list.cssRules.length - 1; i >= 0; i--) {
          const rule = list.cssRules[i];
          if (rule.cssRules && !rule.selectorText) walk(rule);
          else if (rule.selectorText && test(rule.selectorText.replace(/"/g, "").replace(/,\s+/g, ","))) {
            list.deleteRule(i);
            removed++;
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
    }
    const force = () => void document.body.offsetHeight;
    force();
    const time = (fn) => {
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        fn(i);
        force();
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      return Math.round(samples[2] * 10) / 10;
    };
    const deep = document.querySelectorAll("button")[Math.floor(document.querySelectorAll("button").length * 0.8)];
    const classChange = time(() => deep.classList.toggle("x-bench"));
    const extra = [];
    const insertion = time(() => {
      const div = document.createElement("div");
      div.className = "x-bench-portal";
      document.body.appendChild(div);
      extra.push(div);
    });
    extra.forEach((div) => div.remove());
    force();
    const bodyAttr = time((i) => document.body.setAttribute("data-x-bench", String(i)));
    return { removed, elements: document.getElementsByTagName("*").length, classChangeMs: classChange, insertIntoBodyMs: insertion, bodyAttributeMs: bodyAttr };
  }, predicate);
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
  for (const [name, predicate] of GROUPS) {
    const result = await run(context, predicate);
    console.log(JSON.stringify({ group: name, ...result }));
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
