// «Telegram» на стенде: открыть адрес под владельцем и выполнить выражение (SWEEP_URL, SWEEP_JS, необязательно SWEEP_SCROLL).
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = "http://localhost:3021"; const TOKEN = process.env.TG_FAKE_TOKEN!;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")); const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
function forge(id: number) { const p = new URLSearchParams(); p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5)); p.set("user", JSON.stringify({ id, first_name: "Т" })); const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n"); const s = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256", s).update(dcs).digest("hex")); return p.toString(); }
(async () => { await db.user.updateMany({ where: { telegramChatId: "990005" }, data: { telegramChatId: null } }); const me = await db.user.update({ where: { email: state.users.ownerA.email }, data: { telegramChatId: "990005" }, select: { organizationId: true } });
  let url = process.env.SWEEP_URL!; const m = url.match(/DOC:(\w+)/); if (m) { const d = await db.journalDocument.findFirst({ where: { organizationId: me.organizationId, status: "active", template: { code: m[1] } }, orderBy: { createdAt: "desc" }, select: { id: true } }); url = `/journals/${m[1]}/documents/${d!.id}`; }
  const b = await chromium.launch({ headless: true }); const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true }); await ctx.addInitScript(HOST); const page = await ctx.newPage();
  await page.goto(`${BASE}/mini#tgWebAppData=${encodeURIComponent(forge(990005))}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`, { waitUntil: "load", timeout: 300000 }); await page.waitForURL((u: URL) => u.pathname !== "/mini", { timeout: 120000 }).catch(() => null);
  await page.goto(BASE + url, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(3000); if (process.env.SWEEP_SCROLL) { await page.mouse.wheel(0, Number(process.env.SWEEP_SCROLL)); await page.waitForTimeout(600); }
  console.log(JSON.stringify(await page.evaluate(process.env.SWEEP_JS!), null, 1)); if (process.env.SWEEP_SHOT) await page.screenshot({ path: process.env.SWEEP_SHOT });
  await b.close(); await db.$disconnect(); })().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
