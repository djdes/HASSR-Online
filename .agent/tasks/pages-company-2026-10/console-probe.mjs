// Ошибки консоли на страницах «Моя компания» (что за «1 Issue» в оверлее Next).
// node .agent/tasks/pages-company-2026-10/console-probe.mjs [base] [mini]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3073";
const MINI = process.argv[3] === "mini";
const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), "raw");
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "ru-RU" });
const page = await context.newPage();
const log = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) log.push({ url: page.url(), type: message.type(), text: message.text().slice(0, 6000) });
});
page.on("pageerror", (error) => log.push({ url: page.url(), type: "pageerror", text: error.message.slice(0, 600) }));
const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email: "admin@haccp.local", password: "admin1234" } });
if (!res.ok()) throw new Error(`login ${res.status()}`);
if (MINI) await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
for (const href of (process.argv[4] ? process.argv[4].split(",") : ["/settings/organization", "/settings/organization/documents", "/settings/organization/branding", "/settings/organization/contacts"])) {
  await new Promise((resolve) => setTimeout(resolve, 2700));
  await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  log.push({ url: href, type: "visited" });
}
fs.writeFileSync(path.join(RAW, `console-${MINI ? "mini" : "mobile"}.json`), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
await browser.close();
