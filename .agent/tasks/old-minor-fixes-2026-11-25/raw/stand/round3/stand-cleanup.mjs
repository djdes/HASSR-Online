// Уборка стенда: документы «… мелочи …» без точки и активная точка демо-пользователей.
import { createRequire } from "node:module";
const require = createRequire("/home/user/HASSR-Online/package.json");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");
const BASE = "http://localhost:3000";
const pg = new Client({ connectionString: process.env.DATABASE_URL }); await pg.connect();
const browser = await chromium.launch();
async function login(email, password) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 120000 });
  await page.fill("#email", email); await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 }), page.click('button[type="submit"]')]);
  return ctx.request;
}
const owner = await login("admin@haccp.local", "admin1234");
const cook = await login("cook-e2e-special@haccp.local", "cook-e2e-2026");
const docs = (await pg.query(`select id, title from "JournalDocument" where title like '%мелочи%' and "buildingId" is null`)).rows;
for (const doc of docs) {
  const res = await owner.delete(`${BASE}/api/journal-documents/${doc.id}`);
  console.log("delete doc", doc.title, res.status());
}
for (const [who, api] of [["owner", owner], ["cook", cook]]) {
  const res = await api.post(`${BASE}/api/me/active-building`, { data: { buildingId: "organization" } });
  console.log("active building → organization", who, res.status(), (await res.text()).slice(0, 120));
}
const left = (await pg.query(`select count(*)::int c from "JournalDocument" where title like '%мелочи%'`)).rows[0].c;
console.log("left docs", left);
await browser.close(); await pg.end();
