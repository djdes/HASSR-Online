import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/login`);
  // Форма входа ждёт загрузки страницы (master #332): поля, заполненные до гидратации, сбрасываются.
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);
await page.fill("#email", "hotcook1@haccp.local");
await page.fill("#password", "admin1234");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
const res = await page.goto(`${BASE}/production-control/item/1-1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const url = page.url();
const hasPanel = await page.locator("[data-ppk-item-page], [data-ppk-org-info]").count();
console.log(`${hasPanel === 0 && !url.endsWith("/production-control/item/1-1") ? "PASS" : "FAIL"} повар: страница пункта закрыта — ${res?.status()} → ${url}`);
for (const [method, path, body] of [
  ["GET", "/api/production-control/records?block=contracts", null],
  ["POST", "/api/production-control/records", { block: "text-terms", data: { text: "x" } }],
  ["POST", "/api/production-control/prp/fill", { block: "prp-medical" }],
  ["POST", "/api/production-control/products/import", null],
  ["POST", "/api/production-control/org-chart", null],
  ["POST", "/api/production-control/acknowledgements/pin", { userId: "x", pin: "1234" }],
]) {
  const r = method === "GET" ? await context.request.get(`${BASE}${path}`) : await context.request.post(`${BASE}${path}`, body ? { data: body } : {});
  console.log(`${r.status() === 403 ? "PASS" : "FAIL"} повар: ${method} ${path.split("?")[0]} → ${r.status()}`);
}
await browser.close();
