// Повар: прямо /mini/today — ждём ответ /api/mini/today и карточки задач.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const BASE = process.argv[2] || "http://localhost:3060";
const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
let exe;
for (const r of [root, "D:/handoff/wesetup-2026-10-18/ms-playwright"]) {
  if (!fs.existsSync(r)) continue;
  for (const d of fs.readdirSync(r)) { const e = path.join(r, d, "chrome-win64", "chrome.exe"); if (/^chromium-\d+$/.test(d) && fs.existsSync(e)) exe = e; }
  if (exe) break;
}
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "ru-RU" });
const page = await ctx.newPage();
const log = [];
page.on("pageerror", (e) => log.push("pageerror " + e.message.slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") log.push("console " + m.text().slice(0, 160)); });
page.on("framenavigated", (f) => { if (f === page.mainFrame()) log.push("nav " + f.url()); });
const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: "hotcook1@haccp.local", password: "admin1234" }, timeout: 600_000 });
console.log("login", login.status());
const apiPromise = page.waitForResponse((r) => r.url().includes("/api/mini/today"), { timeout: 240_000 }).then((r) => r.status()).catch((e) => "no-response: " + e.message.slice(0, 60));
await page.goto(`${BASE}/mini/today`, { waitUntil: "domcontentloaded", timeout: 600_000 });
const api = await apiPromise;
await page.waitForTimeout(3000);
const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 220);
await page.screenshot({ path: "D:/wt/integ-sketch/.agent/tasks/integ-sketch-wave-2026-10/raw/cook-today.png" });
console.log(JSON.stringify({ url: page.url(), api, text, log: log.slice(0, 12) }, null, 1));
await browser.close();
