// PPK_OVERVIEW_CLASSIC=1: прежний вид у всех, кнопки вида нет (сервер на BASE_URL запущен с переменной).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${BASE}/login`); await page.waitForLoadState("load"); await page.waitForTimeout(1500);
await page.fill("#email", "admin@haccp.local"); await page.fill("#password", "admin1234");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
await page.context().addCookies([{ name: "ppk-overview", value: "new", url: BASE }]);
await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle" });
const classic = await page.locator('[data-ppk-overview="classic"]').count();
const toggle = await page.locator("[data-ppk-view-toggle]").count();
const ok = classic === 1 && toggle === 0;
console.log(`${ok ? "PASS" : "FAIL"} AC6 PPK_OVERVIEW_CLASSIC=1: прежний вид у всех (даже с cookie «new»), кнопки вида нет — classic=${classic}, toggle=${toggle}`);
await page.screenshot({ path: process.argv[2] ?? "killswitch.png" });
await browser.close();
process.exit(ok ? 0 : 1);
