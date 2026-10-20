// Какой JS-файл даёт «Invalid or unexpected token»: качаем все скрипты страницы и
// проверяем синтаксис в node (vm.Script). Запуск: node chunk-probe.mjs [base] [path] [mini|mobile]
import { chromium } from "playwright";
import vm from "node:vm";

const BASE = process.argv[2] || "http://localhost:3076";
const HREF = process.argv[3] || "/inspection/visits";
const MODE = process.argv[4] || "mini";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "ru-RU" });
const page = await context.newPage();
await page.request.post(`${BASE}/api/auth/login`, { data: { email: "chef@haccp.local", password: "admin1234" } });
if (MODE === "mini") await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
const scripts = new Map();
page.on("response", async (response) => {
  const url = response.url();
  if (!/\.js(\?|$)/.test(url)) return;
  try {
    scripts.set(url, await response.text());
  } catch {}
});
const errors = [];
page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message} | ${String(error.stack).slice(0, 300)}`));
await page.goto(`${BASE}${HREF}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(3_000);
const bad = [];
for (const [url, code] of scripts) {
  try {
    new vm.Script(code, { filename: url });
  } catch (error) {
    const nonAscii = [...code].filter((ch) => ch.charCodeAt(0) === 0xfffd).length;
    bad.push({ url, error: String(error.message).slice(0, 120), bytes: code.length, replacementChars: nonAscii });
  }
}
console.log(JSON.stringify({ href: HREF, mode: MODE, scripts: scripts.size, errors, bad }, null, 2));
await browser.close();
