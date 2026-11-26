// Verifier (independent) stand checks for AC1 (DELETE rows by body form) and AC2 (moving a row
// out of a future day). Own test point + hygiene document; special mode, building automation,
// document autoFill and users' active point are restored at the end; the point and document are deleted.
// Usage (env loaded, next dev on :3000): node ac1-ac2-stand.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, db, reporter, dayKey, session } from "./lib.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(OUT, { recursive: true });
const { check, finish } = reporter(`${OUT}/ac1-ac2-results.json`);
const { client, q } = await db();
const ADMIN = (await q(`select id, "organizationId", "lastActiveBuildingId" from "User" where email='admin@haccp.local'`))[0];
const COOK = (await q(`select id, "lastActiveBuildingId" from "User" where email='cook-e2e-special@haccp.local'`))[0];
const ORG = ADMIN.organizationId;
const KEY = `org-journal-controls:${ORG}`;
const setting = (await q(`select value, "updatedAt"::text as "updatedAt" from "PlatformSetting" where key=$1`, [KEY]))[0] ?? null;
const DATA = { status: "day_off", temperatureAbove37: null };
const D = (n) => dayKey(n);
console.log(`today (Moscow) = ${D(0)}; special-mode setting before: ${setting?.value}`);

const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const cook = await session(browser, "cook-e2e-special@haccp.local", "cook-e2e-2026");
let point = null; let doc = null;

const automation = async ({ on, pastDays = false, limit = 3 }) => {
  await q(`update "Building" set "journalAutomationJson"=$2::jsonb where id=$1`, [point.id, on ? JSON.stringify({ hygiene: { autoCreate: true, autoFill: true } }) : null]);
  await q(`update "JournalDocument" set "autoFill"=$2 where id=$1`, [doc.id, on]);
  const value = { automation: { enabled: on, autoFill: on, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays, pastDaysLimit: limit }, sensorCamera: { cold_equipment_control: false, climate_control: false }, brakerageSetup: {} };
  await q(`insert into "PlatformSetting"(key, value, "updatedAt") values ($1, $2, now()) on conflict (key) do update set value=excluded.value, "updatedAt"=now()`, [KEY, JSON.stringify(value)]);
};
const row = async (employeeId, d) => (await q(`select id from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2 and date=$3::date`, [doc.id, employeeId, d]))[0] ?? null;
const put = async (employeeId, d) => {
  await q(`insert into "JournalDocumentEntry"(id, "documentId", "employeeId", date, data, "createdAt", "updatedAt")
           values ('cver' || substr(md5(random()::text), 1, 21), $1, $2, $3::date, $4::jsonb, now(), now())
           on conflict ("documentId", "employeeId", date) do nothing`, [doc.id, employeeId, d, JSON.stringify(DATA)]);
  return row(employeeId, d);
};
const drop = (employeeId, d) => q(`delete from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2 and date=$3::date`, [doc.id, employeeId, d]);
const count = async () => Number((await q(`select count(*)::int n from "JournalDocumentEntry" where "documentId"=$1`, [doc.id]))[0].n);
const call = async (who, method, data, raw) => {
  const url = `${BASE}/api/journal-documents/${doc.id}/entries`;
  const res = await who.request.fetch(url, { method, ...(raw !== undefined ? { data: raw, headers: { "content-type": "application/json" } } : { data }) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
};
const del = (who, data, raw) => call(who, "DELETE", data, raw);

try {
  // ---------- setup ----------
  const made = await owner.request.post(`${BASE}/api/settings/buildings`, { data: { name: `Verifier AC1-2 ${new Date().toISOString().slice(11, 19)}`, sphere: "food" } });
  point = (await made.json().catch(() => ({}))).building;
  check("setup: test point created", made.ok() && point?.id, String(made.status()));
  for (const who of [owner, cook]) await who.request.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });
  const monthStart = `${D(0).slice(0, 8)}01`;
  const monthEnd = new Date(Date.UTC(Number(D(0).slice(0, 4)), Number(D(0).slice(5, 7)), 0)).toISOString().slice(0, 10);
  const created = await owner.request.post(`${BASE}/api/journal-documents`, { data: { templateCode: "hygiene", title: `Verifier гигиена ${D(0)}`, dateFrom: monthStart, dateTo: monthEnd } });
  doc = (await created.json().catch(() => ({}))).document;
  check("setup: hygiene document created", created.ok() && doc?.id, `${created.status()} rows=${doc ? await count() : "-"}`);
  await q(`delete from "JournalDocumentEntry" where "documentId"=$1`, [doc.id]); // start from a clean grid

  // ---------- AC1: automation document ----------
  // The automation lock compares with the UTC day (getStartOfToday) while the window counts from the
  // Moscow day, so «in window but locked without it» is 2 days ago (stable at any hour).
  const a6 = await put(ADMIN.id, D(-6)); const a2 = await put(ADMIN.id, D(-2)); const a1 = await put(ADMIN.id, D(-1)); await put(ADMIN.id, D(0));
  await put(COOK.id, D(-6)); await put(COOK.id, D(-2)); await put(COOK.id, D(-1));
  await automation({ on: true, pastDays: false });
  let r = await del(owner, { employeeId: ADMIN.id, date: D(-2) });
  check("AC1 automation doc, no past-days window: {employeeId, date: 2 days ago} — 403 past_day_locked", r.status === 403 && r.body.code === "past_day_locked" && (await row(ADMIN.id, D(-2))), `${r.status} ${r.body.code ?? ""}`);
  await automation({ on: true, pastDays: true, limit: 3 });
  r = await del(owner, { employeeId: ADMIN.id, date: D(-2) });
  check("AC1 window 3 days: {employeeId, date: 2 days ago} — 200, deleted 1 (old code: 403 because of the -6 row)", r.status === 200 && r.body.deleted === 1 && !(await row(ADMIN.id, D(-2))), `${r.status} ${JSON.stringify(r.body)}`);
  check("AC1 only that employee's row of that day: admin -6/-1/today and cook -2 untouched",
    (await row(ADMIN.id, D(-6))) && (await row(ADMIN.id, D(-1))) && (await row(ADMIN.id, D(0))) && (await row(COOK.id, D(-2))));
  r = await del(owner, { employeeId: ADMIN.id, date: D(-2) });
  check("AC1 same request again (no such row) — 200 deleted 0", r.status === 200 && r.body.deleted === 0, `${r.status} ${JSON.stringify(r.body)}`);
  r = await del(owner, { employeeId: ADMIN.id, date: D(-6) });
  check("AC1 {employeeId, date: 6 days ago} (beyond window) — 403 past_day_locked, row kept", r.status === 403 && r.body.code === "past_day_locked" && (await row(ADMIN.id, D(-6))), `${r.status} ${r.body.code ?? ""}`);
  r = await del(owner, { employeeId: ADMIN.id, date: `${D(-2)}T15:30:00.000Z` });
  check("AC1 date with a time part maps to that day (UTC midnight) — 200", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  r = await del(owner, { ids: [a6.id] });
  check("AC1 {ids: [row beyond window]} — 403, row kept", r.status === 403 && r.body.code === "past_day_locked" && (await row(ADMIN.id, D(-6))), `${r.status} ${r.body.code ?? ""}`);
  r = await del(owner, { ids: [a6.id], employeeId: COOK.id });
  check("AC1 {ids: [admin row beyond window], employeeId: cook} — 403 (lock check uses exactly the ids; old code checked ids∩employee and deleted)", r.status === 403 && (await row(ADMIN.id, D(-6))), `${r.status} ${r.body.code ?? ""}`);
  r = await del(owner, { ids: [a1.id], employeeId: COOK.id, date: D(-2) });
  check("AC1 {ids: [admin -1 row], employeeId: cook, date: -2} — exactly that id deleted (200, 1); cook's -2 row kept", r.status === 200 && r.body.deleted === 1 && !(await row(ADMIN.id, D(-1))) && (await row(COOK.id, D(-2))), `${r.status} ${JSON.stringify(r.body)}`);
  r = await del(owner, { employeeId: ADMIN.id });
  check("AC1 {employeeId} — whole row incl. a locked day — 403, nothing deleted", r.status === 403 && (await row(ADMIN.id, D(-6))) && (await row(ADMIN.id, D(0))), `${r.status} ${r.body.code ?? ""}`);
  r = await del(owner, { ids: [], employeeId: ADMIN.id, date: D(0) });
  check("AC1 {ids: [], employeeId, date: today} — empty ids ignored, today's row deleted (200, 1)", r.status === 200 && r.body.deleted === 1 && !(await row(ADMIN.id, D(0))), `${r.status} ${JSON.stringify(r.body)}`);
  r = await del(owner, { employeeId: COOK.id, date: D(-6) });
  check("AC1 cook's row 6 days ago by manager — 403", r.status === 403 && (await row(COOK.id, D(-6))), `${r.status} ${r.body.code ?? ""}`);
  r = await del(owner, { employeeId: COOK.id, date: D(-2) });
  check("AC1 cook's row 2 days ago (in window) by manager — 200, deleted 1", r.status === 200 && r.body.deleted === 1 && !(await row(COOK.id, D(-2))), `${r.status} ${JSON.stringify(r.body)}`);
  r = await del(owner, { employeeId: ADMIN.id, date: "не дата" });
  check("AC1 invalid date — 400 «Некорректная дата»", r.status === 400 && r.body.error === "Некорректная дата", `${r.status} ${r.body.error}`);
  r = await del(owner, {});
  const r2 = await del(owner, { date: D(-1) });
  const r3 = await del(owner, undefined, "{not json");
  check("AC1 empty body / only date / malformed JSON — 400", r.status === 400 && r2.status === 400 && r3.status === 400, `${r.status} ${r2.status} ${r3.status}`);
  r = await del(cook, { employeeId: COOK.id, date: D(-1) });
  check("AC1 staff (cook) cannot DELETE — 403, row kept", r.status === 403 && (await row(COOK.id, D(-1))), `${r.status} ${r.body.error ?? ""}`);
  // Not an automation document: no day locks on DELETE (unchanged).
  await automation({ on: false });
  r = await del(owner, { employeeId: ADMIN.id, date: D(-6) });
  check("AC1 regular document: {employeeId, date: 6 days ago} — 200, deleted 1", r.status === 200 && r.body.deleted === 1, `${r.status} ${JSON.stringify(r.body)}`);
  r = await del(owner, { employeeId: COOK.id });
  check("AC1 regular document: {employeeId} — every row of the employee (cook: -6 and -1)", r.status === 200 && r.body.deleted === 2 && !(await row(COOK.id, D(-6))) && !(await row(COOK.id, D(-1))), `${r.status} ${JSON.stringify(r.body)}`);

  // ---------- AC2: moving a row out of a future day ----------
  await q(`delete from "JournalDocumentEntry" where "documentId"=$1`, [doc.id]);
  const f2 = await put(ADMIN.id, D(2));
  r = await call(owner, "PUT", { entryId: f2.id, employeeId: ADMIN.id, date: D(0), data: DATA });
  const movedTo = (await q(`select to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where id=$1`, [f2.id]))[0]?.d;
  check("AC2 manager moves own row from the day after tomorrow to today — 200, same row now today", r.status === 200 && movedTo === D(0), `${r.status} ${r.body.code ?? ""} → ${movedTo}`);
  r = await call(owner, "PUT", { entryId: f2.id, employeeId: ADMIN.id, date: D(2), data: DATA });
  check("AC2 moving a row INTO a future day — 403 future_day_locked", r.status === 403 && r.body.code === "future_day_locked", `${r.status} ${r.body.code ?? ""}`);
  r = await call(owner, "PUT", { employeeId: ADMIN.id, date: D(3), data: DATA });
  check("AC2 writing a future day — 403 future_day_locked, nothing created", r.status === 403 && r.body.code === "future_day_locked" && !(await row(ADMIN.id, D(3))), `${r.status} ${r.body.code ?? ""}`);
  const cf = await put(COOK.id, D(2));
  r = await call(cook, "PUT", { entryId: cf.id, employeeId: COOK.id, date: D(0), data: DATA });
  check("AC2 staff moves own row from a future day — 403 not_today, row stays", r.status === 403 && r.body.code === "not_today" && (await row(COOK.id, D(2))), `${r.status} ${r.body.code ?? ""}`);
  r = await call(owner, "PUT", { entryId: cf.id, employeeId: COOK.id, date: D(-1), data: DATA });
  const cookMoved = (await q(`select to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where id=$1`, [cf.id]))[0]?.d;
  check("AC2 manager moves cook's future row to yesterday (allowed day) — 200", r.status === 200 && cookMoved === D(-1), `${r.status} ${r.body.code ?? ""} → ${cookMoved}`);
  // Automation document: source on a locked past day still refused; a future source is fine.
  await drop(ADMIN.id, D(0));
  const p6 = await put(ADMIN.id, D(-6));
  const f1 = await put(ADMIN.id, D(1));
  await automation({ on: true, pastDays: false });
  r = await call(owner, "PUT", { entryId: p6.id, employeeId: ADMIN.id, date: D(0), data: DATA });
  check("AC2 automation doc: source on a locked past day — 403 past_day_locked (source still checked)", r.status === 403 && r.body.code === "past_day_locked" && (await row(ADMIN.id, D(-6))), `${r.status} ${r.body.code ?? ""}`);
  r = await call(owner, "PUT", { entryId: f1.id, employeeId: ADMIN.id, date: D(0), data: DATA });
  check("AC2 automation doc: manager moves tomorrow's row to today — 200", r.status === 200 && (await row(ADMIN.id, D(0)))?.id === f1.id, `${r.status} ${r.body.code ?? ""}`);
  await automation({ on: false });
} finally {
  // ---------- restore ----------
  if (doc) {
    await q(`update "JournalDocument" set "autoFill"=false where id=$1`, [doc.id]).catch(() => {});
    const d = await owner.request.delete(`${BASE}/api/journal-documents/${doc.id}`);
    check("cleanup: document deleted", d.ok(), String(d.status()));
  }
  if (point) {
    await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [point.id]).catch(() => {});
    const d = await owner.request.delete(`${BASE}/api/settings/buildings/${point.id}`);
    check("cleanup: test point deleted", d.ok(), String(d.status()));
  }
  if (setting === null) await q(`delete from "PlatformSetting" where key=$1`, [KEY]);
  else await q(`update "PlatformSetting" set value=$2, "updatedAt"=$3::timestamp where key=$1`, [KEY, setting.value, setting.updatedAt]);
  await q(`update "User" set "lastActiveBuildingId"=$2 where id=$1`, [ADMIN.id, ADMIN.lastActiveBuildingId]);
  await q(`update "User" set "lastActiveBuildingId"=$2 where id=$1`, [COOK.id, COOK.lastActiveBuildingId]);
  const after = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
  check("cleanup: special mode setting restored", after === (setting?.value ?? null));
  const failed = finish();
  await browser.close();
  await client.end();
  process.exitCode = failed ? 1 : 0;
}
