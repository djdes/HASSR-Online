// «Telegram» на стенде: все журналы — список журнала и документ (карточки), полностраничные снимки и поиск обрезанного/сокращённого текста.
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = "http://localhost:3021"; const TOKEN = process.env.TG_FAKE_TOKEN!; const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true });
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")); const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8"); const PROBE = fs.readFileSync(path.join(HERE, "text-probe.js"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const ROLE = process.env.SWEEP_ROLE ?? "ownerA"; const VW = Number(process.env.SWEEP_VW ?? 360); const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
const TG_IDS: Record<string, number> = { cookA: 990001, managerA: 990002, headA: 990004, ownerA: 990005 };
function forge(id: number) { const p = new URLSearchParams(); p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5)); p.set("user", JSON.stringify({ id, first_name: "Т" })); const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n"); const s = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256", s).update(dcs).digest("hex")); return p.toString(); }
(async () => { const tgId = TG_IDS[ROLE]; await db.user.updateMany({ where: { telegramChatId: String(tgId) }, data: { telegramChatId: null } }); const me = await db.user.update({ where: { email: state.users[ROLE].email }, data: { telegramChatId: String(tgId), themePreference: "light" }, select: { organizationId: true } });
  const docs = await db.journalDocument.findMany({ where: { organizationId: me.organizationId, status: "active" }, select: { id: true, template: { select: { code: true } } }, orderBy: { createdAt: "desc" } }); const first = new Map<string, string>(); for (const d of docs) if (!first.has(d.template.code)) first.set(d.template.code, d.id);
  const b = await chromium.launch({ headless: true }); const ctx = await b.newContext({ viewport: { width: VW, height: 700 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); await ctx.addInitScript(HOST);
  await ctx.addInitScript(`try{localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){};document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})`);
  const page = await ctx.newPage(); await page.goto(`${BASE}/mini#tgWebAppData=${encodeURIComponent(forge(tgId))}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`, { waitUntil: "load", timeout: 300000 }); await page.waitForURL((u: URL) => u.pathname !== "/mini", { timeout: 120000 }).catch(() => null);
  const report: any[] = [];
  for (const [code, id] of first) { if (ONLY && !ONLY.test(code)) continue;
    for (const [kind, url] of [["list", `/journals/${code}`], ["doc", `/journals/${code}/documents/${id}`]] as const) {
      try { await page.goto(BASE + url, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(2200);
        for (const name of ["Понятно", "OK", "Закрыть"]) { const x = page.getByRole("button", { name, exact: true }).first(); if (await x.isVisible().catch(() => false)) { await x.click().catch(() => null); await page.waitForTimeout(300); } }
        const p: any = await page.evaluate(PROBE); await page.screenshot({ path: path.join(OUT, `${code}.${kind}.png`), fullPage: true }).catch(() => null);
        report.push({ code, kind, ...p }); const n = p.cut.length + p.squeezed.length + p.offscreen.length + (p.pageOverflow ? 1 : 0);
        if (n || p.ellipsis.length) console.log(code, kind, JSON.stringify({ page: p.pageOverflow || undefined, cut: p.cut.slice(0, 4), squeezed: p.squeezed.slice(0, 4), off: p.offscreen.slice(0, 3), ell: p.ellipsis.slice(0, 5) }).slice(0, 900));
      } catch (e) { console.log(code, kind, "FAIL", String(e).slice(0, 100)); } }
    fs.writeFileSync(path.join(OUT, "journals-text.json"), JSON.stringify(report, null, 1)); }
  console.log("done", report.length); await b.close(); await db.$disconnect(); })().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
