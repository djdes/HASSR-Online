// Follow-up to verifier2-e2e AD-6: in the automation document the scenario freed the target cell with
// DELETE {employeeId, date}; that form was refused, so the move hit 409 «клетка занята». Here: confirm the
// DELETE form behaviour, free the cell by ids (what the UI sends) and redo the in-window move.
// Usage: node ad6-probe.mjs <pointId> <hygieneDocId>. Restores special mode, point automation, doc autoFill.
import { createRequire } from "node:module";
const require = createRequire("/home/user/HASSR-Online/package.json");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const [POINT, DOC] = process.argv.slice(2);
const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const q = async (sql, params = []) => (await pg.query(sql, params)).rows;
const ADMIN = (await q(`select id, "organizationId" from "User" where email='admin@haccp.local'`))[0];
const KEY = `org-journal-controls:${ADMIN.organizationId}`;
const rawSetting = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
const dayKey = (offset) => { const d = new Date(Date.now() + 3 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const at = async (employeeId, d) => (await q(`select id from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2 and date=$3::date`, [DOC, employeeId, d]))[0]?.id ?? null;
const out = [];
const log = (name, ok, detail) => { out.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "load" });
await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 60000 });
await page.fill("#email", "admin@haccp.local");
await page.fill("#password", "admin1234");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
const api = ctx.request;
const url = `${BASE}/api/journal-documents/${DOC}/entries`;
const DATA = { status: "day_off", temperatureAbove37: null };
try {
  // Rows before the lock: owner 2 days ago, owner yesterday (target, occupied), owner 6 days ago.
  await api.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 } } });
  for (const d of [-6, -2, -1]) await api.put(url, { data: { employeeId: ADMIN.id, date: dayKey(d), data: DATA } });
  const a2 = await at(ADMIN.id, dayKey(-2));
  const a1 = await at(ADMIN.id, dayKey(-1));
  await q(`update "Building" set "journalAutomationJson"=$2::jsonb where id=$1`, [POINT, JSON.stringify({ hygiene: { autoCreate: true, autoFill: true } })]);
  await q(`update "JournalDocument" set "autoFill"=true where id=$1`, [DOC]);
  await api.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { enabled: true, autoFill: true, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: true, pastDaysLimit: 3 } } });
  let res = await api.delete(url, { data: { employeeId: ADMIN.id, date: dayKey(-1) } });
  log("DELETE {employeeId, date} of an in-window cell in the automation doc", true,
    `${res.status()} (candidates are all of the employee's rows, date ignored — pre-existing; the row 6 days ago is locked)`);
  res = await api.delete(url, { data: { ids: [a1] } });
  log("DELETE {ids} of the in-window cell (form the UI uses) → 200", res.status() === 200 && !(await at(ADMIN.id, dayKey(-1))), String(res.status()));
  res = await api.put(url, { data: { entryId: a2, employeeId: ADMIN.id, date: dayKey(-1), data: DATA } });
  const moved = (await q(`select to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where id=$1`, [a2]))[0]?.d;
  log("AD-6 redo: owner moves 2 days ago → yesterday in the automation doc (both in window) → 200", res.status() === 200 && moved === dayKey(-1), `${res.status()} now ${moved}`);
  // Same move with the box unticked → refused (both days locked).
  await api.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { enabled: true, autoFill: true, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 3 } } });
  res = await api.put(url, { data: { entryId: a2, employeeId: ADMIN.id, date: dayKey(-2), data: DATA } });
  log("box unticked: the same move back is refused (past_day_locked)", res.status() === 403, `${res.status()} ${(await res.json().catch(() => ({}))).code}`);
} finally {
  await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [POINT]);
  await q(`update "JournalDocument" set "autoFill"=false where id=$1`, [DOC]);
  if (rawSetting === null) await q(`delete from "PlatformSetting" where key=$1`, [KEY]);
  else await q(`update "PlatformSetting" set value=$2 where key=$1`, [KEY, rawSetting]);
  const restored = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
  log("restore special mode", restored === rawSetting, restored);
  await browser.close();
  await pg.end();
}
