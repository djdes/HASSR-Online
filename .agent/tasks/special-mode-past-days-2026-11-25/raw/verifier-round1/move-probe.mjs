// Probe (pre-existing path): PUT with entryId lets staff move someone else's old entry onto their own row today.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/home/user/HASSR-Online/package.json");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");
const BASE = "http://localhost:3000";
const COOK = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const dayKey = (offset) => { const d = new Date(Date.now() + 3 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const doc = (await pg.query(`select id, "buildingId" from "JournalDocument" where "organizationId"=$1 and title like 'Гигиена верификатор %' and "autoFill"=false order by "createdAt" desc limit 1`, [COOK.organizationId])).rows[0];
const browser = await chromium.launch();
const out = [];
try {
  const login = async (email, password) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 30000 });
    await page.fill("#email", email); await page.fill("#password", password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
    return ctx.request;
  };
  const owner = await login("admin@haccp.local", "admin1234");
  const cook = await login(COOK.email, COOK.password);
  await cook.post(`${BASE}/api/me/active-building`, { data: { buildingId: doc.buildingId } });
  await owner.post(`${BASE}/api/me/active-building`, { data: { buildingId: doc.buildingId } });
  await pg.query(`delete from "JournalDocumentEntry" where "documentId"=$1`, [doc.id]);
  const old = dayKey(-20);
  const created = await owner.put(`${BASE}/api/journal-documents/${doc.id}/entries`, { data: { employeeId: COOK.adminId, date: old, data: { status: "day_off", temperatureAbove37: null } } });
  const entry = (await created.json()).entry;
  out.push(["owner writes own row", old, created.status()]);
  const moved = await cook.put(`${BASE}/api/journal-documents/${doc.id}/entries`, { data: { entryId: entry.id, employeeId: COOK.cookId, date: dayKey(0), data: { status: "day_off", temperatureAbove37: null } } });
  const row = (await pg.query(`select "employeeId", to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where id=$1`, [entry.id])).rows[0];
  out.push(["cook PUT entryId=owner's entry → own row today (special mode off)", moved.status(), JSON.stringify(row)]);
} finally {
  await pg.query(`delete from "JournalDocumentEntry" where "documentId"=$1`, [doc.id]);
  await pg.end(); await browser.close();
}
for (const row of out) console.log(row.join(" | "));
