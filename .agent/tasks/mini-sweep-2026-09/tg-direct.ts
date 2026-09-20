// «Telegram»: прямая загрузка экранов (обновление страницы / переход из раздела сайта) — с кукой и без неё.
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = "http://localhost:3021"; const TOKEN = process.env.TG_FAKE_TOKEN!;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")); const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
function forge(id: number) { const p = new URLSearchParams(); p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5)); p.set("user", JSON.stringify({ id, first_name: "Т" })); const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n"); const s = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256", s).update(dcs).digest("hex")); return p.toString(); }
(async () => { await db.user.updateMany({ where: { telegramChatId: "990002" }, data: { telegramChatId: null } }); await db.user.update({ where: { email: state.users.managerA.email }, data: { telegramChatId: "990002" } });
  const b = await chromium.launch({ headless: true }); const hash = "#tgWebAppData=" + encodeURIComponent(forge(990002)) + "&tgWebAppVersion=8.0&tgWebAppPlatform=ios";
  for (const mode of ["no-cookie", "cookie"]) { const ctx = await b.newContext({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true }); await ctx.addInitScript(HOST); const page = await ctx.newPage();
    if (mode === "cookie") { await page.goto(`${BASE}/mini${hash}`, { waitUntil: "load", timeout: 300000 }); await page.waitForFunction(`!/Загружаем/.test(document.body.innerText)`, null, { timeout: 120000 }).catch(() => null); }
    for (const r of ["/mini/me", "/mini/staff", "/mini/equipment"]) { const t0 = Date.now(); await page.goto(`${BASE}${r}${mode === "cookie" ? "" : hash}`, { waitUntil: "load", timeout: 300000 });
      const ok = await page.waitForFunction(`!/Загружаем/.test((document.querySelector('main')||document.body).innerText.slice(0,200)) && (document.querySelector('main')||document.body).innerText.trim().length>20`, null, { timeout: 60000 }).then(() => true).catch(() => false);
      console.log(mode, r, ok ? "READY" : "STUCK", Date.now() - t0, "ms →", await page.evaluate(`location.pathname`), JSON.stringify(await page.evaluate(`(document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').slice(0,60)`))); if (mode === "no-cookie") await ctx.clearCookies(); }
    await ctx.close(); }
  await b.close(); await db.$disconnect(); })().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
