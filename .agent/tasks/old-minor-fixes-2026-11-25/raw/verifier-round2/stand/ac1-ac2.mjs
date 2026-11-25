// Verifier round 2 (independent): AC1 (DELETE by employee and day, malformed ids) and AC2 (move a row
// from a future day) on the running app. Own test point + own hygiene document; at the end the document
// is deleted (deleting a point only nulls Document.buildingId), the point is deleted, special mode and the
// users' active point are restored.
// Usage (env loaded, next dev on :3000): node ac1-ac2.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, db, reporter, session, dayKey } from "./lib.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(OUT, { recursive: true });
const { check, finish } = reporter(`${OUT}/ac1-ac2-results.json`);
const { client, q } = await db();
const ADMIN = (await q(`select id, "organizationId", "lastActiveBuildingId" from "User" where email='admin@haccp.local'`))[0];
const COOK = (await q(`select id, "lastActiveBuildingId" from "User" where email='cook-e2e-special@haccp.local'`))[0];
const ORG = ADMIN.organizationId;
const KEY = `org-journal-controls:${ORG}`;
const rawSetting = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
const docsBefore = Number((await q(`select count(*)::int c from "JournalDocument" where "organizationId"=$1`, [ORG]))[0].c);
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const cook = await session(browser, "cook-e2e-special@haccp.local", "cook-e2e-2026");
// Health journal: the builder's leftover org-wide «Гигиена мелочи» documents (Nov 1–30, buildingId null after
// their points were deleted) make a new November hygiene document a 409 «За этот период уже есть документ».
const TEMPLATE = process.env.AC_TEMPLATE ?? "health_check";
const DATA = TEMPLATE === "hygiene" ? { status: "day_off", temperatureAbove37: null } : { signed: true, measures: null };
const OFF = { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 };
let point = null;
let doc = null;

const call = async (who, method, url, data) => {
  const res = await who.request.fetch(url, { method, ...(data !== undefined ? { data } : {}) });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 120) }; }
  return { status: res.status(), body };
};
const rowsOf = async (employeeId) =>
  (await q(`select id, to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2 order by date`, [doc.id, employeeId]));
const rowAt = async (employeeId, d) =>
  (await q(`select id from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2 and date=$3::date`, [doc.id, employeeId, d]))[0] ?? null;
// A row as if it was there before (prefill / before special mode): direct insert, the API refuses future days.
const ensureRow = async (employeeId, d) => {
  const have = await rowAt(employeeId, d);
  if (have) return have.id;
  const rows = await q(
    `insert into "JournalDocumentEntry"(id, "documentId", "employeeId", date, data, "createdAt", "updatedAt")
     values ('cvr2' || substr(md5(random()::text), 1, 21), $1, $2, $3::date, $4::jsonb, now(), now()) returning id`,
    [doc.id, employeeId, d, JSON.stringify(DATA)],
  );
  return rows[0].id;
};

try {
  console.log(`Moscow today=${dayKey(0)} (UTC now ${new Date().toISOString()})`);
  const made = await call(owner, "POST", `${BASE}/api/settings/buildings`, { name: `Проверка-2 ${new Date().toISOString().slice(11, 19)}`, sphere: "food" });
  point = made.body.building;
  check("setup: own point", made.status === 200 && point?.id, String(made.status));
  for (const who of [owner, cook]) await who.request.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });
  const today = dayKey(0);
  const monthStart = `${today.slice(0, 8)}01`;
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const created = await call(owner, "POST", `${BASE}/api/journal-documents`, { templateCode: TEMPLATE, title: `Проверка-2 ${TEMPLATE} ${today}`, dateFrom: monthStart, dateTo: monthEnd });
  doc = created.body.document;
  check(`setup: own ${TEMPLATE} document`, created.status < 300 && doc?.id, `${created.status} ${JSON.stringify(created.body).slice(0, 80)}`);
  const url = `${BASE}/api/journal-documents/${doc.id}/entries`;
  await call(owner, "PATCH", `${BASE}/api/settings/journal-controls`, { automation: OFF });

  // ---------------- AC1 ----------------
  const minus6 = dayKey(-6), minus1 = dayKey(-1), minus2 = dayKey(-2);
  for (const d of [minus6, minus2, minus1]) {
    const r = await call(owner, "PUT", url, { employeeId: ADMIN.id, date: d, data: DATA });
    if (r.status !== 200) console.log(`  (setup PUT owner ${d}: ${r.status} ${JSON.stringify(r.body).slice(0, 80)})`);
  }
  for (const d of [minus6, minus1]) {
    const r = await call(owner, "PUT", url, { employeeId: COOK.id, date: d, data: DATA });
    if (r.status !== 200) console.log(`  (setup PUT cook ${d}: ${r.status} ${JSON.stringify(r.body).slice(0, 80)})`);
  }
  check("setup: owner rows -6/-2/-1 and cook rows -6/-1 exist",
    Boolean((await rowAt(ADMIN.id, minus6)) && (await rowAt(ADMIN.id, minus2)) && (await rowAt(ADMIN.id, minus1)) && (await rowAt(COOK.id, minus6)) && (await rowAt(COOK.id, minus1))));
  // Automation document + special mode with a 3-day window.
  await q(`update "Building" set "journalAutomationJson"=$2::jsonb where id=$1`, [point.id, JSON.stringify({ [TEMPLATE]: { autoCreate: true, autoFill: true } })]);
  await q(`update "JournalDocument" set "autoFill"=true where id=$1`, [doc.id]);
  let r = await call(owner, "PATCH", `${BASE}/api/settings/journal-controls`, { automation: { ...OFF, enabled: true, autoFill: true, pastDays: true, pastDaysLimit: 3 } });
  check("setup: special mode on, past days window 3", r.status === 200 && r.body?.automation?.pastDays === true && r.body?.automation?.pastDaysLimit === 3, `${r.status} ${JSON.stringify(r.body?.automation ?? {})}`);

  r = await call(owner, "DELETE", url, { employeeId: ADMIN.id, date: minus1 });
  check("AC1 automation doc, window 3: DELETE {employeeId, date:-1} → 200 deleted 1 (old locked -6 row of the same employee exists)",
    r.status === 200 && r.body.deleted === 1 && !(await rowAt(ADMIN.id, minus1)), `${r.status} ${JSON.stringify(r.body)}`);
  check("AC1 only that row: owner -6 and -2 rows and cook -1 row intact",
    Boolean((await rowAt(ADMIN.id, minus6)) && (await rowAt(ADMIN.id, minus2)) && (await rowAt(COOK.id, minus1))));
  r = await call(owner, "DELETE", url, { employeeId: ADMIN.id, date: minus6 });
  check("AC1 row outside the window: DELETE {employeeId, date:-6} → 403 past_day_locked", r.status === 403 && r.body.code === "past_day_locked", `${r.status} ${r.body.code ?? JSON.stringify(r.body)}`);
  const lockedId = (await rowAt(ADMIN.id, minus6))?.id;
  r = await call(owner, "DELETE", url, { ids: [lockedId] });
  check("AC1 {ids:[row -6]} → 403, row intact", r.status === 403 && Boolean(await rowAt(ADMIN.id, minus6)), `${r.status} ${r.body.code ?? ""}`);
  r = await call(owner, "DELETE", url, { ids: [lockedId], employeeId: COOK.id, date: minus1 });
  check("AC1 {ids:[locked], employeeId: other, date} → ids win → 403", r.status === 403 && Boolean(await rowAt(ADMIN.id, minus6)) && Boolean(await rowAt(COOK.id, minus1)), `${r.status} ${r.body.code ?? ""}`);
  const before = (await rowsOf(ADMIN.id)).length;
  r = await call(owner, "DELETE", url, { employeeId: ADMIN.id });
  check("AC1 {employeeId} whole row with a locked day → 403, nothing deleted", r.status === 403 && (await rowsOf(ADMIN.id)).length === before, `${r.status} rows ${before}→${(await rowsOf(ADMIN.id)).length}`);
  r = await call(owner, "DELETE", url, { employeeId: ADMIN.id, date: "не дата" });
  check("AC1 invalid date → 400 «Некорректная дата»", r.status === 400 && r.body.error === "Некорректная дата", `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(owner, "DELETE", url, {});
  check("AC1 {} → 400", r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(owner, "DELETE", url, { date: minus2 });
  check("AC1 {date} only → 400", r.status === 400, `${r.status}`);

  // Round-1 minor issue: malformed ids must not fall back to «delete the employee's whole row».
  const n0 = (await rowsOf(ADMIN.id)).length;
  for (const [label, body] of [
    ["{ids:[5], employeeId}", { ids: [5], employeeId: ADMIN.id }],
    ["{ids:[null,\"\"], employeeId}", { ids: [null, ""], employeeId: ADMIN.id }],
    ["{ids:\"abc\", employeeId}", { ids: "abc", employeeId: ADMIN.id }],
    ["{ids:{}, employeeId}", { ids: {}, employeeId: ADMIN.id }],
    ["{ids:[5], employeeId, date:-2}", { ids: [5], employeeId: ADMIN.id, date: minus2 }],
    ["{ids:[\"x\", 5]}", { ids: ["x", 5] }],
  ]) {
    r = await call(owner, "DELETE", url, body);
    check(`round-1 malformed ids ${label} → 400 «Некорректный список строк», rows intact`, r.status === 400 && r.body.error === "Некорректный список строк" && (await rowsOf(ADMIN.id)).length === n0, `${r.status} ${JSON.stringify(r.body)} rows ${n0}→${(await rowsOf(ADMIN.id)).length}`);
  }
  r = await call(owner, "DELETE", url, { ids: [], employeeId: ADMIN.id, date: minus2 });
  check("AC1 {ids:[], employeeId, date:-2} → empty ids ignored → deletes the -2 row (in window) → 200 deleted 1", r.status === 200 && r.body.deleted === 1 && !(await rowAt(ADMIN.id, minus2)), `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(owner, "DELETE", url, { ids: null, employeeId: COOK.id, date: minus1 });
  check("AC1 {ids:null, employeeId: cook, date:-1} → like no ids → 200 deleted 1", r.status === 200 && r.body.deleted === 1 && !(await rowAt(COOK.id, minus1)), `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(cook, "DELETE", url, { employeeId: COOK.id, date: minus6 });
  check("AC1 cook (staff) DELETE → 403", r.status === 403, `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);

  // Back to a regular document: no locks; {employeeId} deletes the whole row; {ids} exactly those rows.
  await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [point.id]);
  await q(`update "JournalDocument" set "autoFill"=false where id=$1`, [doc.id]);
  await call(owner, "PATCH", `${BASE}/api/settings/journal-controls`, { automation: OFF });
  const a = await ensureRow(COOK.id, dayKey(-3));
  const b = await ensureRow(COOK.id, dayKey(-4));
  const c = await ensureRow(COOK.id, dayKey(-5));
  r = await call(owner, "DELETE", url, { ids: [a, b] });
  check("AC1 regular doc {ids:[a,b]} → exactly those 2 rows", r.status === 200 && r.body.deleted === 2 && !(await rowAt(COOK.id, dayKey(-3))) && !(await rowAt(COOK.id, dayKey(-4))) && Boolean(await rowAt(COOK.id, dayKey(-5))), `${r.status} ${JSON.stringify(r.body)}`);
  const cookRows = (await rowsOf(COOK.id)).length;
  r = await call(owner, "DELETE", url, { employeeId: COOK.id });
  check("AC1 regular doc {employeeId} → the employee's whole row", r.status === 200 && r.body.deleted === cookRows && (await rowsOf(COOK.id)).length === 0, `${r.status} ${JSON.stringify(r.body)} (had ${cookRows}, c=${c ? "yes" : "no"})`);

  // ---------------- AC2 ----------------
  const plus2 = dayKey(2), plus3 = dayKey(3);
  const ownerFuture = await ensureRow(ADMIN.id, plus2);
  const ownerToday = await rowAt(ADMIN.id, today);
  if (ownerToday) await q(`delete from "JournalDocumentEntry" where id=$1`, [ownerToday.id]);
  r = await call(owner, "PUT", url, { entryId: ownerFuture, employeeId: ADMIN.id, date: today, data: DATA });
  const moved = (await q(`select to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where id=$1`, [ownerFuture]))[0]?.d;
  check("AC2 manager moves own row +2 → today → 200 (same row now today)", r.status === 200 && moved === today, `${r.status} ${r.body.code ?? ""} → ${moved}`);
  r = await call(owner, "PUT", url, { entryId: ownerFuture, employeeId: ADMIN.id, date: plus2, data: DATA });
  check("AC2 moving INTO a future day → 403 future_day_locked", r.status === 403 && r.body.code === "future_day_locked", `${r.status} ${r.body.code ?? ""}`);
  r = await call(owner, "PUT", url, { employeeId: ADMIN.id, date: plus3, data: DATA });
  check("AC2 writing a future day → 403 future_day_locked", r.status === 403 && r.body.code === "future_day_locked", `${r.status} ${r.body.code ?? ""}`);
  const cookFuture = await ensureRow(COOK.id, plus2);
  r = await call(cook, "PUT", url, { entryId: cookFuture, employeeId: COOK.id, date: today, data: DATA });
  check("AC2 staff (cook) moves own +2 row → 403", r.status === 403, `${r.status} ${r.body.code ?? JSON.stringify(r.body).slice(0, 80)}`);
  check("AC2 cook's +2 row not moved", Boolean(await rowAt(COOK.id, plus2)));
  r = await call(owner, "PUT", url, { entryId: cookFuture, employeeId: COOK.id, date: today, data: DATA });
  const cookMoved = (await q(`select to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where id=$1`, [cookFuture]))[0]?.d;
  check("AC2 manager moves the cook's +2 row → today → 200", r.status === 200 && cookMoved === today, `${r.status} ${r.body.code ?? ""} → ${cookMoved}`);
  // Source on a locked past day in an automation doc is still refused.
  await q(`update "Building" set "journalAutomationJson"=$2::jsonb where id=$1`, [point.id, JSON.stringify({ [TEMPLATE]: { autoCreate: true, autoFill: true } })]);
  await q(`update "JournalDocument" set "autoFill"=true where id=$1`, [doc.id]);
  await call(owner, "PATCH", `${BASE}/api/settings/journal-controls`, { automation: { ...OFF, enabled: true, autoFill: true, pastDays: true, pastDaysLimit: 3 } });
  const oldRow = (await rowAt(ADMIN.id, minus6))?.id;
  const todayRow = await rowAt(ADMIN.id, today);
  if (todayRow) await q(`delete from "JournalDocumentEntry" where id=$1`, [todayRow.id]);
  r = await call(owner, "PUT", url, { entryId: oldRow, employeeId: ADMIN.id, date: today, data: DATA });
  check("AC2 automation doc: source on a locked past day (-6) → 403 past_day_locked", r.status === 403 && r.body.code === "past_day_locked", `${r.status} ${r.body.code ?? ""}`);
  const ownerFuture2 = await ensureRow(ADMIN.id, dayKey(1));
  r = await call(owner, "PUT", url, { entryId: ownerFuture2, employeeId: ADMIN.id, date: today, data: DATA });
  check("AC2 automation doc: source +1 → today → 200", r.status === 200, `${r.status} ${r.body.code ?? ""}`);
} catch (error) {
  check("script error", false, String(error?.stack ?? error).slice(0, 400));
} finally {
  if (point) await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [point.id]).catch(() => {});
  if (doc) await q(`delete from "JournalDocument" where id=$1`, [doc.id]).catch((e) => console.log("doc delete failed", e.message));
  if (point) {
    const d = await owner.request.delete(`${BASE}/api/settings/buildings/${point.id}`);
    check("cleanup: own point deleted", d.ok(), String(d.status()));
  }
  if (rawSetting === null) await q(`delete from "PlatformSetting" where key=$1`, [KEY]);
  else await q(`update "PlatformSetting" set value=$2 where key=$1`, [KEY, rawSetting]);
  await q(`update "User" set "lastActiveBuildingId"=$2 where id=$1`, [ADMIN.id, ADMIN.lastActiveBuildingId]);
  await q(`update "User" set "lastActiveBuildingId"=$2 where id=$1`, [COOK.id, COOK.lastActiveBuildingId]);
  const restored = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
  check("cleanup: special mode restored", JSON.stringify(restored) === JSON.stringify(rawSetting));
  const docsAfter = Number((await q(`select count(*)::int c from "JournalDocument" where "organizationId"=$1`, [ORG]))[0].c);
  check("cleanup: no documents left behind", docsAfter === docsBefore, `${docsBefore}→${docsAfter}`);
  const failed = finish();
  await browser.close();
  await client.end();
  process.exitCode = failed ? 1 : 0;
}
