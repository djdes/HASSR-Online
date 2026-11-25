// Probe: does a crafted UTC offset in `date` move a staff write one day beyond the special-mode window?
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/home/user/HASSR-Online/package.json");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");
const BASE = "http://localhost:3000";
const COOK = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const KEY = `org-journal-controls:${COOK.organizationId}`;
const raw = (await pg.query(`select value from "PlatformSetting" where key=$1`, [KEY])).rows[0]?.value ?? null;
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
  await owner.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { enabled: true, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: true, pastDaysLimit: 1 } } });
  await pg.query(`delete from "JournalDocumentEntry" where "documentId"=$1`, [doc.id]);
  const put = async (date) => { const r = await cook.put(`${BASE}/api/journal-documents/${doc.id}/entries`, { data: { employeeId: COOK.cookId, date, data: { status: "day_off", temperatureAbove37: null } } }); return { status: r.status(), body: await r.json().catch(() => ({})) }; };
  const plain = await put(dayKey(-2));
  out.push(["limit 1: plain 2 days ago", plain.status, plain.body.error ?? ""]);
  const crafted = await put(`${dayKey(-1)}T00:00:00+14:00`);
  const stored = (await pg.query(`select to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2`, [doc.id, COOK.cookId])).rows.map((r) => r.d);
  out.push([`limit 1: crafted "${dayKey(-1)}T00:00:00+14:00"`, crafted.status, `stored dates: ${stored.join(",")} (2 days ago = ${dayKey(-2)})`]);
  // Same trick against the pre-existing "today only" rule (special mode off).
  await owner.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 } } });
  await pg.query(`delete from "JournalDocumentEntry" where "documentId"=$1`, [doc.id]);
  const crafted2 = await put(`${dayKey(0)}T00:00:00+14:00`);
  const stored2 = (await pg.query(`select to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2`, [doc.id, COOK.cookId])).rows.map((r) => r.d);
  out.push([`special mode off: crafted "${dayKey(0)}T00:00:00+14:00" (pre-existing rule)`, crafted2.status, `stored dates: ${stored2.join(",")} (yesterday = ${dayKey(-1)})`]);
} finally {
  await pg.query(`delete from "JournalDocumentEntry" where "documentId"=$1`, [doc.id]);
  if (raw === null) await pg.query(`delete from "PlatformSetting" where key=$1`, [KEY]);
  else await pg.query(`update "PlatformSetting" set value=$2, "updatedAt"=now() where key=$1`, [KEY, raw]);
  const after = (await pg.query(`select value from "PlatformSetting" where key=$1`, [KEY])).rows[0]?.value ?? null;
  out.push(["restored special-mode setting", after === raw ? "ok" : "MISMATCH", ""]);
  await pg.end(); await browser.close();
}
for (const row of out) console.log(row.join(" | "));
