// Ошибки консоли на страницах раздела и на нетронутой странице для сравнения.
// Запуск: node .agent/tasks/pages-inspection-2026-10/console-probe.mjs [base] [mobile|mini|desktop]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3076";
const MODE = process.argv[3] || "mini";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGES = ["/inspection", "/inspection/visits", "/inspection/norms", "/inspection/experts", "/inspection/special-mode", "/settings/names"];

const browser = await chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });
const context = await browser.newContext(
  MODE === "desktop"
    ? { viewport: { width: 1440, height: 900 }, locale: "ru-RU" }
    : { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ru-RU" },
);
const page = await context.newPage();
await page.request.post(`${BASE}/api/auth/login`, { data: { email: "admin@haccp.local", password: "admin1234" } });
if (MODE === "mini") await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
const out = {};
let current = "";
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") (out[current] ??= []).push(`${message.type()}: ${message.text().slice(0, 300)}`);
});
page.on("pageerror", (error) => (out[current] ??= []).push(`pageerror: ${error.message.slice(0, 300)}`));
for (const href of PAGES) {
  current = href;
  out[href] = [];
  await new Promise((resolve) => setTimeout(resolve, 2_800));
  await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
}
await browser.close();
fs.writeFileSync(path.join(HERE, "raw", `console-${MODE}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
