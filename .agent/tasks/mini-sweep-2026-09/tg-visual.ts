// «Telegram» на стенде, узкий телефон: ищем всё, что вылезает за экран, обрезается, перекрывается или слишком мелкое для пальца. Полностраничные снимки.
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = "http://localhost:3021"; const TOKEN = process.env.TG_FAKE_TOKEN!;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")); const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8");
const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const ROLE = process.env.SWEEP_ROLE ?? "ownerA"; const THEME = process.env.SWEEP_THEME ?? "light"; const VW = Number(process.env.SWEEP_VW ?? 360); const VH = Number(process.env.SWEEP_VH ?? 640);
const TG_IDS: Record<string, number> = { cookA: 990001, managerA: 990002, headA: 990004, ownerA: 990005 }; const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
function forge(id: number) { const p = new URLSearchParams(); p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5)); p.set("user", JSON.stringify({ id, first_name: "Т" })); const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n"); const s = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256", s).update(dcs).digest("hex")); return p.toString(); }
const PROBE = fs.readFileSync(path.join(HERE, "visual-probe.js"), "utf8");
(async () => {
  const tgId = TG_IDS[ROLE]; await db.user.updateMany({ where: { telegramChatId: String(tgId) }, data: { telegramChatId: null } }); const me = await db.user.update({ where: { email: state.users[ROLE].email }, data: { telegramChatId: String(tgId), themePreference: THEME }, select: { organizationId: true } });
  const docs = await db.journalDocument.findMany({ where: { organizationId: me.organizationId, status: "active" }, select: { id: true, template: { select: { code: true } } }, orderBy: { createdAt: "desc" } }); const first = new Map<string, string>(); for (const d of docs) if (!first.has(d.template.code)) first.set(d.template.code, d.id);
  let routes: string[] = JSON.parse(fs.readFileSync(path.join(HERE, "parity-routes.json"), "utf8")).filter((r: string) => r !== "/staff" && r !== "/settings/equipment/qr-sheet");
  routes = ["/mini", "/mini/today", "/mini/journals", "/mini/staff", "/mini/equipment", "/mini/reports", "/mini/audit", "/mini/iot", "/mini/shift-handover", "/mini/shift", "/mini/balance", "/mini/me", "/mini/sections", "/mini/outbox", ...[...first.keys()].slice(0, 35).map((c) => `/mini/journals/${c}`), ...[...first.values()].slice(0, 35).map((id) => `/mini/documents/${id}`), ...routes];
  const b = await chromium.launch({ headless: true }); const ctx = await b.newContext({ viewport: { width: VW, height: VH }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: THEME === "dark" ? "dark" : "light" }); await ctx.addInitScript(HOST);
  await ctx.addInitScript(`try{localStorage.setItem("wesetup.mini.tour.seen",String(Date.now()));localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){}`);
  // Значок ошибок dev-сборки Next перекрывает угол и даёт ложные «перекрытия» — прячем.
  await ctx.addInitScript(`(function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';(document.head||document.documentElement).appendChild(s)})()`);
  const page = await ctx.newPage(); const hash = "#tgWebAppData=" + encodeURIComponent(forge(tgId)) + "&tgWebAppVersion=8.0&tgWebAppPlatform=ios";
  await page.goto(`${BASE}/mini${hash}`, { waitUntil: "load", timeout: 300000 }); await page.waitForFunction(`!/Загружаем кабинет/.test(document.body.innerText)`, null, { timeout: 120000 }).catch(() => null);
  const report: any[] = [];
  for (const route of routes) { if (ONLY && !ONLY.test(route)) continue;
    try { await page.goto(BASE + route, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(1600); const p: any = await page.evaluate(PROBE);
      const name = route.replace(/\W+/g, "_").slice(0, 70); await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
      report.push({ route, ...p }); const n = p.clipped.length + p.overflowText.length + p.tiny.length + p.overlap.length + (p.pageOverflow ? 1 : 0);
      if (n) console.log(route, JSON.stringify({ page: p.pageOverflow || undefined, clipped: p.clipped.slice(0, 3), text: p.overflowText.slice(0, 3), tiny: p.tiny.slice(0, 3), overlap: p.overlap.slice(0, 3) }).slice(0, 700));
    } catch (e) { console.log(route, "FAIL", String(e).slice(0, 120)); }
    fs.writeFileSync(path.join(OUT, `tg-visual.json`), JSON.stringify(report, null, 1)); }
  console.log("screens:", report.length); await b.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
