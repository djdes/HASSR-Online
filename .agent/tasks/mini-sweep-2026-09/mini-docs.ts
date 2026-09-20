// Мини-приложение: открывает документ каждого журнала, включает «Таблица», проверяет прокрутку вбок, снимает экран и печать.
import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = process.env.SWEEP_BASE ?? "http://localhost:3021";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true });
const ROLE = process.env.SWEEP_ROLE ?? "managerA"; const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
const PROBE = fs.readFileSync(path.join(HERE, "table-probe.js"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
(async () => {
  const user = await db.user.findUnique({ where: { email: state.users[ROLE].email }, select: { organizationId: true } });
  const docs = await db.journalDocument.findMany({ where: { organizationId: user!.organizationId, status: "active" }, select: { id: true, template: { select: { code: true } } }, orderBy: { createdAt: "desc" } });
  const first = new Map<string, string>(); for (const d of docs) if (!first.has(d.template.code)) first.set(d.template.code, d.id);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); let errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/hydrat|DevTools|same key/i.test(m.text())) errs.push("console: " + m.text().slice(0, 180)); });
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 180)));
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon|_next\/static/.test(r.url())) errs.push(`http ${r.status()} ${r.url().replace(BASE, "").slice(0, 100)}`); });
  { const EMAIL = state.users[ROLE].email; let okLogin = false; for (let k = 0; k < 6 && !okLogin; k++) { const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: state.password }, timeout: 300000 }).catch(() => null); okLogin = Boolean(r && r.ok()); if (!okLogin) await new Promise((res) => setTimeout(res, 8000)); } if (!okLogin) throw new Error("login failed"); await page.goto(`${BASE}/mini`, { waitUntil: "load", timeout: 300000 }); }
  await page.evaluate(() => { try { localStorage.setItem("wesetup.mini.tour.seen", String(Date.now())); localStorage.setItem("wesetup.last-seen-build-sha", "zzz"); } catch {} });
  const report: any[] = [];
  for (const [code, id] of first) {
    if (ONLY && !ONLY.test(code)) continue; errs = [];
    try {
      const resp = await page.goto(`${BASE}/mini/documents/${id}`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(2200);
      for (const name of ["Понятно", "OK"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => null); await page.waitForTimeout(250); } }
      const cards = await page.evaluate(PROBE); await page.screenshot({ path: path.join(OUT, `${code}.cards.png`) });
      const tab = page.getByRole("button", { name: "Таблица", exact: true }).or(page.getByRole("tab", { name: "Таблица", exact: true })).last();
      let table: any = null; if (await tab.isVisible().catch(() => false)) { await tab.click().catch(() => null); await page.waitForTimeout(900); table = await page.evaluate(PROBE); await page.screenshot({ path: path.join(OUT, `${code}.table.png`) }); }
      const links = await page.evaluate(`Array.from(document.querySelectorAll('main a[href], .mini-document-host a[href]')).map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/') && !h.startsWith('/mini') && !h.startsWith('/api')).slice(0,6)`);
      await page.emulateMedia({ media: "print" }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(OUT, `${code}.print.png`), fullPage: false }); await page.emulateMedia({ media: "screen" });
      const row = { code, status: resp?.status(), final: page.url().replace(BASE, ""), cards, table, siteLinks: links, errs: errs.slice(0, 5) };
      report.push(row); const bad = (table?.tables ?? []).filter((t: any) => t.wider && (!t.scroller || !t.moved));
      console.log(code, JSON.stringify({ st: row.status, pageSW: (table ?? cards).pageScrollW, tables: (table?.tables ?? []).length, stuck: bad.length, siteLinks: (links as any[]).length, errs: row.errs.length }));
    } catch (e) { report.push({ code, error: String(e).slice(0, 200) }); console.log(code, "ERR", String(e).slice(0, 120)); }
    fs.writeFileSync(path.join(OUT, `mini-docs.${ROLE}.json`), JSON.stringify(report, null, 1));
  }
  await browser.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
