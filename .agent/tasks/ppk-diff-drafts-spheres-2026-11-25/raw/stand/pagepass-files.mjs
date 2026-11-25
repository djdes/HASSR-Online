import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "load" });
await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 30000 });
await page.fill("#email", "admin@haccp.local");
await page.fill("#password", "admin1234");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
for (const path of ["/api/production-control/haccp-plan/pdf", "/api/production-control/program/pdf"]) {
  const r = await context.request.get(`${BASE}${path}`, { timeout: 180000 });
  const body = await r.body();
  console.log(`file\t${path}\t${r.status()}\t${r.headers()["content-type"]}\t${body.length}\t${body.subarray(0, 5).toString()}`);
}
await browser.close();
