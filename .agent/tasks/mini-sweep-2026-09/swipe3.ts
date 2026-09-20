import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const BASE = "http://localhost:3021"; const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
async function drag(cdp: any, x0: number, y0: number, x1: number, y1: number) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y: y0 + ((y1 - y0) * i) / 12 }] }); await new Promise((r) => setTimeout(r, 16)); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
(async () => {
  const browser = await chromium.launch({ headless: true }); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: state.users.managerA.email, password: state.password }, timeout: 300000 }); if (!r.ok()) throw new Error("login " + r.status());
  await page.goto(`${BASE}/mini`, { waitUntil: "load", timeout: 300000 }); await page.evaluate(() => { try { localStorage.setItem("wesetup.mini.tour.seen", "1"); localStorage.setItem("wesetup.last-seen-build-sha", "zzz"); } catch {} });
  const cdp = await ctx.newCDPSession(page);
  for (const u of (process.env.URLS ?? "").split(",")) {
    await page.goto(`${BASE}/${u}`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(5000);
    if (u.includes("documents")) { const tabs = page.getByText("Таблица", { exact: true }); for (let k = (await tabs.count()) - 1; k >= 0; k--) { if (await tabs.nth(k).isVisible().catch(() => false)) { await tabs.nth(k).click(); break; } } await page.waitForTimeout(1200); }
    const read = () => page.evaluate(`(() => { const tb = Array.from(document.querySelectorAll('table')).filter(x => x.getBoundingClientRect().width > 400)[0]; let h = null; for (let n = tb ? tb.parentElement : null; n && n !== document.body; n = n.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(n).overflowX) && n.scrollWidth > n.clientWidth + 2) { h = n; break; } } return { left: h ? h.scrollLeft : -1, top: Math.round(window.scrollY) }; })()`) as Promise<any>;
    const a = await read(); await drag(cdp, 200, 600, 200, 250); await page.waitForTimeout(800); const b = await read();
    await drag(cdp, 330, 520, 60, 520); await page.waitForTimeout(800); const c = await read();
    // «потяни, чтобы обновить» сверху страницы не должен срабатывать от движения вбок
    await page.evaluate("window.scrollTo(0,0)"); await page.waitForTimeout(300); await drag(cdp, 330, 420, 60, 440); await page.waitForTimeout(600); const d = await read();
    console.log(u, JSON.stringify({ start: a, afterUp: b, afterLeft: c, afterLeftAtTop: d, vertical: b.top > a.top + 50, horizontal: c.left > b.left + 50, horizontalAtTop: d.left > c.left + 20 || d.left > 50 }));
  }
  await browser.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
