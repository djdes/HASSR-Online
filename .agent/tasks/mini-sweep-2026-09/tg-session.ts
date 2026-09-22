// Общая заготовка для обходчиков: «Telegram» на стенде под выбранной ролью.
// Использование в своём скрипте:
//   import { openTelegramSession } from "D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09/tg-session";
//   const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
//   await s.page.goto(s.base + "/journals"); ... await s.close();
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { chromium, type Page, type BrowserContext } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
export const BASE = "http://localhost:3021";
const TOKEN = process.env.TG_FAKE_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8");
export const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const TG_IDS: Record<string, number> = { cookA: 990001, managerA: 990002, cleanerA: 990003, headA: 990004, ownerA: 990005, managerB: 990006, cookB: 990007 };
function forge(id: number) { const p = new URLSearchParams(); p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5)); p.set("user", JSON.stringify({ id, first_name: "Т" })); const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n"); const s = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256", s).update(dcs).digest("hex")); return p.toString(); }
export { db };
export async function openTelegramSession(opts: { role: string; width?: number; height?: number; theme?: "light" | "dark" }) {
  const tgId = TG_IDS[opts.role]; if (!tgId) throw new Error("unknown role " + opts.role);
  await db.user.updateMany({ where: { telegramChatId: String(tgId) }, data: { telegramChatId: null } });
  const user = await db.user.update({ where: { email: state.users[opts.role].email }, data: { telegramChatId: String(tgId), themePreference: opts.theme ?? "light" }, select: { id: true, organizationId: true, name: true, role: true } });
  const browser = await chromium.launch({ headless: true });
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: opts.width ?? 360, height: opts.height ?? 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: opts.theme === "dark" ? "dark" : "light" });
  await ctx.addInitScript(HOST);
  // Значок ошибок dev-сборки Next перекрывает левый нижний угол — прячем, чтобы не мешал снимкам и кликам.
  await ctx.addInitScript(`try{localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){};document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})`);
  const page: Page = await ctx.newPage(); const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|DevTools|hydrat/i.test(m.text())) errors.push("console: " + m.text().slice(0, 200)); });
  page.on("response", (r) => { if (r.status() >= 400 && !/_next\/static|favicon/.test(r.url())) errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 100)}`); });
  await page.goto(`${BASE}/mini#tgWebAppData=${encodeURIComponent(forge(tgId))}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`, { waitUntil: "load", timeout: 300000 });
  await page.waitForURL((u: URL) => u.pathname !== "/mini", { timeout: 120000 }).catch(() => null); await page.waitForTimeout(1500);
  return { browser, ctx, page, errors, user, base: BASE, pressTelegramBack: () => page.evaluate(`window.__tgHost.pressBack()`), close: async () => { await browser.close(); await db.$disconnect(); } };
}
