// Прогрев dev-сервера перед e2e «Фото к замеру»: каждая страница и API-маршрут компилируются один раз,
// иначе dev пересобирает их посреди сценария и перезагружает открытые страницы.
// Запуск: SP=<временная папка ВНЕ рабочей копии: fixture.json> node warmup.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire("C:/wt/tphoto/package.json");
const { chromium } = require("playwright-core");
const fx = JSON.parse(readFileSync(`${process.env.SP}/fixture.json`, "utf8"));
const BASE = process.env.BASE ?? "http://localhost:3048";

const browser = await chromium.launch({ executablePath: "C:/Users/Yaroslav/AppData/Local/ms-playwright/chromium-1232/chrome-win64/chrome.exe", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU" });
const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 300_000 })).json();
await context.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, email: fx.managerEmail, password: fx.password, json: "true" }, timeout: 300_000 });
const page = await context.newPage();
for (const url of [
  `/equipment-fill/${fx.equipmentId}?token=${encodeURIComponent(fx.equipmentToken)}`,
  `/room-fill/${fx.roomId}?token=${encodeURIComponent(fx.roomToken)}`,
  `/journals/cold_equipment_control/documents/${fx.coldDocumentId}`,
  `/journals/climate_control/documents/${fx.climateDocumentId}`,
]) {
  const started = Date.now();
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps"))), null, { timeout: 300_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log(url.slice(0, 48), `${Date.now() - started} ms`);
}
for (const api of [
  "/api/qr-fill/reading-photo",
  "/api/qr-fill/reading-photo/recognize",
  `/api/equipment-fill/${fx.equipmentId}`,
  `/api/room-fill/${fx.roomId}`,
  "/api/qr-fill/pass",
  "/api/ocr/reading",
  "/uploads/readings/none.jpg",
]) {
  const res = api.startsWith("/uploads")
    ? await context.request.get(`${BASE}${api}`, { timeout: 300_000 })
    : await context.request.post(`${BASE}${api}`, { data: {}, timeout: 300_000 });
  console.log(api, res.status());
}
await browser.close();
