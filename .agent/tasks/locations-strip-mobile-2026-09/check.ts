// Проверка строки точек на телефоне (390×844). С 2026-09-23 блок «Точки сегодня»
// заменён строкой вкладок «Выберите точку» (location-tabs-2026-09).
// Своя организация e2e-org-loc (не e2e-org-a): сначала
//   npx tsx .agent/tasks/location-tabs-2026-09/e2e/setup.ts
// потом
//   npx tsx .agent/tasks/locations-strip-mobile-2026-09/check.ts
import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const BASE = process.env.SWEEP_BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "location-tabs-2026-09", "e2e", "state.json"), "utf8"));
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  let ok = true;
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 }); await page.fill("#email", state.users.manager.email); await page.fill("#password", state.password);
    await page.waitForLoadState("networkidle").catch(() => null); await page.click('button[type="submit"]'); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 300000 });
    for (const url of ["/dashboard", "/journals"]) {
      await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(2500);
      const strip = page.locator('nav[aria-label="Точки"]');
      const m = await strip.evaluate((el) => {
        const vw = document.documentElement.clientWidth;
        const btns = Array.from(el.querySelectorAll("button"));
        const scroller = btns[0]?.parentElement as HTMLElement | undefined;
        return {
          vw, tabs: btns.length,
          navRight: Math.round(el.getBoundingClientRect().right),
          scrollerRight: scroller ? Math.round(scroller.getBoundingClientRect().right) : null,
          stripScrolls: scroller ? scroller.scrollWidth > scroller.clientWidth : false,
          pageScrollW: document.documentElement.scrollWidth,
          headerPill: document.querySelectorAll('[data-tour="location-switcher"]').length,
        };
      });
      const pass = m.tabs === 3 && m.navRight <= m.vw && (m.scrollerRight ?? 0) <= m.vw && m.pageScrollW <= m.vw && m.headerPill === 0;
      ok = ok && pass;
      console.log(url, JSON.stringify(m), pass ? "PASS" : "FAIL");
      await strip.screenshot({ path: path.join(HERE, `tabs-390${url.replace(/\//g, "-")}.png`) });
    }
  } finally { await browser.close(); }
  console.log(ok ? "PASS" : "FAIL"); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("ERR", String(e).slice(0, 300)); process.exit(1); });
