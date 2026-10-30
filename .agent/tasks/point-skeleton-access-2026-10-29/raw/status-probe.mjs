// HTTP-статусы панелей «Нет доступа» / «Такой страницы нет» (локальная база wesetup_access).
// Запуск: BASE=http://localhost:3034 node .agent/tasks/point-skeleton-access-2026-10-29/raw/status-probe.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3034";
const CHROME =
  process.env.CHROME ?? "C:\\Users\\Two\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const [email, paths] of [
    ["dk-chef@test.local", ["/settings/organization", "/checklists/assignments", "/journals/points", "/settings/organization"]],
    ["dk-owner@test.local", ["/settings/does-not-exist", "/production-control/nope"]],
  ]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.fill("#email", email);
    await page.fill("#password", "Test-12345");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 });
    for (const path of paths) {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
      const body = (await response?.text()) ?? "";
      const panel = await page
        .waitForSelector("[data-access-denied]", { timeout: 60000 })
        .then(() => "panel")
        .catch(() => "NO-PANEL");
      const ssr = body.includes("data-access-denied") ? "ssr" : "csr";
      console.log(email, path, response?.status(), panel, ssr, body.includes("__next_error__") ? "errorShell" : "");
    }
    // Тот же адрес «холодным» запросом без браузерной навигации.
    const cold = await page.request.get(`${BASE}${paths[0]}`, { timeout: 180000 });
    console.log(email, paths[0], "request.get", cold.status());
    await ctx.close();
  }
} finally {
  await browser.close();
}
