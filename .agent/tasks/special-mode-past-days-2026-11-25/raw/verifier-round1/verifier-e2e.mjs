// Fresh verifier stand checks for special-mode-past-days-2026-11-25.
// Usage: node verifier-e2e.mjs <out-dir> <cook-setup.json> <verifier-user.json>
// Restores: special-mode PlatformSetting (raw), Organization.lockPastDayEdits, building automation of its own point.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/home/user/HASSR-Online/package.json");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const OUT = process.argv[2];
const COOK = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const VERIFY = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const info = (name, detail) => {
  results.push({ name, info: true, detail });
  console.log(`INFO ${name} — ${detail}`);
};
const errors = [];

const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const ORG = COOK.organizationId;
const KEY = `org-journal-controls:${ORG}`;
const rawSetting = (await pg.query(`select value from "PlatformSetting" where key=$1`, [KEY])).rows[0]?.value ?? null;
const orgRow = (await pg.query(`select "lockPastDayEdits", timezone, "shiftEndHour" from "Organization" where id=$1`, [ORG])).rows[0];
info("start: raw special-mode setting", rawSetting);
info("start: org", JSON.stringify(orgRow));

async function restoreSetting() {
  if (rawSetting === null) await pg.query(`delete from "PlatformSetting" where key=$1`, [KEY]);
  else await pg.query(`insert into "PlatformSetting"(key, value, "updatedAt") values($1,$2,now()) on conflict(key) do update set value=excluded.value, "updatedAt"=now()`, [KEY, rawSetting]);
}

const dayKey = (offset) => {
  const msk = new Date(Date.now() + 3 * 3600 * 1000);
  msk.setUTCDate(msk.getUTCDate() + offset);
  return msk.toISOString().slice(0, 10);
};
const today = dayKey(0);
const monthStart = `${today.slice(0, 8)}01`;
const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function login(context, email, password) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${email}: ${error.message}`));
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 30000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  return page;
}
async function open(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 120000 });
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.count()) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "detached", timeout: 30000 });
  }
}

const browser = await chromium.launch();
let autoPointId = null;
const docIds = [];
try {
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const owner = await login(ownerContext, "admin@haccp.local", "admin1234");
  const ownerApi = ownerContext.request;
  const setAutomation = (automation) => ownerApi.patch(`${BASE}/api/settings/journal-controls`, { data: { automation } });
  const OFF = { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 };

  // ---------- V1: staff with "tasks.verify" (cook + head_chef preset) ----------
  const verifyContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const verifier = await login(verifyContext, VERIFY.email, VERIFY.password);
  await open(verifier, "/inspection");
  check("V1 verifier /inspection opens (tasks.verify)", (await verifier.locator("[data-access-denied]").count()) === 0 && verifier.url().includes("/inspection"), verifier.url());
  check("V1 verifier: no special-mode card on /inspection", (await verifier.locator("[data-inspection-special-mode]").count()) === 0);
  check("V1 verifier: quiet link kept on /inspection", (await verifier.locator("[data-inspection-settings-link]").count()) === 1);
  check("V1 verifier: no «Спецрежим» menu item", (await verifier.locator('a[href="/inspection/settings"]').filter({ hasText: "Спецрежим" }).count()) === 0);
  await verifier.screenshot({ path: `${OUT}/v1-verifier-inspection.png` });
  await open(verifier, "/inspection/settings");
  await verifier.waitForTimeout(1500);
  const deniedPanels = await verifier.locator('[data-access-denied]:visible').count();
  const cardVisible = await verifier.locator("[data-inspection-special-mode]:visible").count();
  const deniedText = deniedPanels ? (await verifier.locator('[data-access-denied]:visible').first().innerText()).replace(/\s+/g, " ").slice(0, 160) : "";
  check("V1 verifier: /inspection/settings still viewable read-only (spec R1 «как было»)", deniedPanels === 0 && cardVisible === 1, JSON.stringify({ deniedPanels, cardVisible, deniedText }));
  await verifier.screenshot({ path: `${OUT}/v1-verifier-settings-page.png` });

  // ---------- V2: enable dialog default for an org that never chose anything ----------
  await setAutomation(OFF);
  await open(owner, "/inspection");
  const card = owner.locator("[data-inspection-special-mode]");
  await card.locator('button[role="switch"]').click();
  const dialog = owner.locator("[data-special-mode-dialog]");
  await dialog.waitFor({ timeout: 15000 });
  const states = {};
  for (const feature of ["autoFill", "autoCreate", "copyYesterday", "closeDayAutofill", "catchUp", "pastDays"]) {
    states[feature] = await dialog.locator(`[data-special-mode-option="${feature}"]`).getAttribute("data-state");
  }
  check("V2 enable dialog (no previous choice): «Правка прошлых дней» NOT pre-checked (default off)", states.pastDays !== "checked", JSON.stringify(states));
  await owner.screenshot({ path: `${OUT}/v2-enable-dialog-defaults.png` });
  await owner.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 15000 }).catch(() => null);

  // ---------- Points / documents ----------
  const pointRes = await ownerApi.post(`${BASE}/api/settings/buildings`, { data: { name: `Кафе e2e верификатор ${new Date().toISOString().slice(11, 19)}`, sphere: "food" } });
  const point = (await pointRes.json().catch(() => ({}))).building;
  check("stand: own point", pointRes.ok() && point?.id, String(pointRes.status()));
  await ownerApi.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });
  const mkDoc = async (title) => {
    const res = await ownerApi.post(`${BASE}/api/journal-documents`, { data: { templateCode: "hygiene", title, dateFrom: monthStart, dateTo: monthEnd } });
    return (await res.json().catch(() => ({}))).document;
  };
  const doc = await mkDoc(`Гигиена верификатор ${today}`);
  if (doc?.id) docIds.push(doc.id);
  check("stand: hygiene doc", Boolean(doc?.id), `${monthStart}..${monthEnd}`);

  const cookContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  await login(cookContext, COOK.email, COOK.password);
  const cookApi = cookContext.request;
  await cookApi.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });
  const data = { status: "day_off", temperatureAbove37: null };
  const cookPut = (docId, date, employeeId = COOK.cookId) => cookApi.put(`${BASE}/api/journal-documents/${docId}/entries`, { data: { employeeId, date, data } });
  const ownerPut = (docId, date, employeeId = COOK.cookId) => ownerApi.put(`${BASE}/api/journal-documents/${docId}/entries`, { data: { employeeId, date, data } });
  const res = async (r) => ({ status: r.status(), body: await r.json().catch(() => ({})) });

  // ---------- V3: saved choice WITHOUT the pastDays key → off ----------
  const legacyChoice = { automation: { enabled: true, autoFill: true, autoCreate: true, copyYesterday: true, closeDayAutofill: true, catchUp: true }, sensorCamera: {}, brakerageSetup: {} };
  await pg.query(`insert into "PlatformSetting"(key, value, "updatedAt") values($1,$2,now()) on conflict(key) do update set value=excluded.value, "updatedAt"=now()`, [KEY, JSON.stringify(legacyChoice)]);
  let r = await res(await cookPut(doc.id, dayKey(-1)));
  check("V3 saved choice without key: cook yesterday → 403 not_today", r.status === 403 && r.body.code === "not_today", `${r.status} ${r.body.error ?? ""}`);
  const filled = await (await ownerApi.get(`${BASE}/api/settings/journal-controls`)).json();
  check("V3 saved choice without key: server reports pastDays false, other boxes kept", filled.automation.pastDays === false && filled.automation.autoFill === true && filled.automation.enabled === true, JSON.stringify(filled.automation));
  // ---------- V4: no stored setting at all (legacy rule) → off ----------
  await pg.query(`delete from "PlatformSetting" where key=$1`, [KEY]);
  r = await res(await cookPut(doc.id, dayKey(-1)));
  const legacy = await (await ownerApi.get(`${BASE}/api/settings/journal-controls`)).json();
  check("V4 no stored setting: pastDays false and cook yesterday → 403", legacy.automation.pastDays === false && r.status === 403, `${r.status} ${JSON.stringify(legacy.automation)}`);

  // ---------- V5: window variants (manual doc) ----------
  await setAutomation({ ...OFF, enabled: true, pastDays: true, pastDaysLimit: 1 });
  r = await res(await cookPut(doc.id, dayKey(-1)));
  check("V5 limit 1: cook yesterday → 200", r.status === 200, String(r.status));
  r = await res(await cookPut(doc.id, dayKey(-2)));
  check("V5 limit 1: cook 2 days ago → 403 «только за вчерашний день»", r.status === 403 && /вчерашний день/.test(r.body.error ?? ""), `${r.status} ${r.body.error ?? ""}`);
  await setAutomation({ ...OFF, enabled: true, pastDays: true, pastDaysLimit: 0 });
  const farBack = Number(today.slice(8, 10)) > 20 ? dayKey(-20) : monthStart;
  r = await res(await cookPut(doc.id, farBack));
  check(`V5 no limit: cook ${farBack} → 200`, r.status === 200, String(r.status));
  r = await res(await cookPut(doc.id, dayKey(1)));
  check("V5 no limit: cook tomorrow → 403", r.status === 403, `${r.status} ${r.body.error ?? ""}`);
  r = await res(await ownerPut(doc.id, dayKey(1)));
  check("V5 no limit: owner tomorrow → 403 future_day_locked", r.status === 403 && r.body.code === "future_day_locked", `${r.status} ${r.body.code ?? ""}`);
  // Special mode ON but box unticked → as before.
  await setAutomation({ ...OFF, enabled: true, autoFill: true, pastDays: false, pastDaysLimit: 30 });
  r = await res(await cookPut(doc.id, dayKey(-1)));
  check("V5 special mode on, box unticked: cook yesterday → 403", r.status === 403 && r.body.code === "not_today", String(r.status));

  // Org lock + window 7.
  await setAutomation({ ...OFF, enabled: true, pastDays: true, pastDaysLimit: 7 });
  await pg.query(`update "Organization" set "lockPastDayEdits"=true where id=$1`, [ORG]);
  const auditCount = async () => Number((await pg.query(`select count(*) from "AuditLog" where "organizationId"=$1 and action='closed_day.override' and "entityId"=$2`, [ORG, doc.id])).rows[0].count);
  const a0 = await auditCount();
  r = await res(await cookPut(doc.id, dayKey(-1)));
  check("V5 org lock on + window: cook yesterday → 200 (lock does not apply in window)", r.status === 200, `${r.status} ${r.body.error ?? ""}`);
  r = await res(await cookPut(doc.id, dayKey(-8)));
  check("V5 org lock on: cook 8 days ago → 403", r.status === 403, `${r.status} ${r.body.error ?? ""}`);
  r = await res(await ownerPut(doc.id, dayKey(-3)));
  const a1 = await auditCount();
  check("V5 org lock on: owner 3 days ago (in window) → 200 without override audit", r.status === 200 && a1 === a0, `${r.status} audit ${a0}→${a1}`);
  r = await res(await ownerPut(doc.id, dayKey(-9)));
  const a2 = await auditCount();
  check("V5 org lock on: owner 9 days ago (beyond window) → 200 with closed_day.override audit", r.status === 200 && a2 === a1 + 1, `${r.status} audit ${a1}→${a2}`);

  // Bulk (paint).
  const bulk = (items) => cookApi.post(`${BASE}/api/journal-documents/${doc.id}/entries/bulk`, { data: { items } });
  r = await res(await bulk([{ employeeId: COOK.cookId, date: dayKey(-2), data }, { employeeId: COOK.cookId, date: today, data }]));
  check("V5 bulk: cook paints 2 days ago + today → saved 2", r.status === 200 && r.body.saved === 2, `${r.status} ${JSON.stringify(r.body)}`);
  r = await res(await bulk([{ employeeId: COOK.cookId, date: dayKey(-2), data }, { employeeId: COOK.cookId, date: dayKey(-8), data }]));
  check("V5 bulk: stroke reaching beyond window → 403", r.status === 403, `${r.status} ${r.body.error ?? ""}`);
  r = await res(await bulk([{ employeeId: COOK.adminId, date: dayKey(-1), data }]));
  check("V5 bulk: other person's row → 403 foreign_row", r.status === 403 && r.body.code === "foreign_row", `${r.status} ${r.body.code ?? ""}`);
  await pg.query(`update "Organization" set "lockPastDayEdits"=$2 where id=$1`, [ORG, orgRow.lockPastDayEdits]);

  // ---------- V6: automation document, PATCH/DELETE by management ----------
  const autoPointRes = await ownerApi.post(`${BASE}/api/settings/buildings`, { data: { name: `Кафе e2e верификатор авто ${new Date().toISOString().slice(11, 19)}`, sphere: "food" } });
  const autoPoint = (await autoPointRes.json().catch(() => ({}))).building;
  autoPointId = autoPoint?.id;
  await ownerApi.post(`${BASE}/api/me/active-building`, { data: { buildingId: autoPoint.id } });
  await cookApi.post(`${BASE}/api/me/active-building`, { data: { buildingId: autoPoint.id } });
  await pg.query(`update "Building" set "journalAutomationJson"=$2::jsonb where id=$1`, [autoPoint.id, JSON.stringify({ hygiene: { autoCreate: true, autoFill: true } })]);
  const autoDocRes = await ownerApi.post(`${BASE}/api/journal-documents`, { data: { templateCode: "hygiene", title: `Гигиена автодок верификатор ${today}`, dateFrom: monthStart, dateTo: monthEnd } });
  const autoDocBody = await autoDocRes.json().catch(() => ({}));
  const autoDoc = autoDocBody.document;
  if (!autoDoc) throw new Error(`auto doc create failed ${autoDocRes.status()} ${JSON.stringify(autoDocBody).slice(0, 200)}`);
  docIds.push(autoDoc.id);
  await pg.query(`update "JournalDocument" set "autoFill"=true where id=$1`, [autoDoc.id]);
  check("stand: automation doc", Boolean(autoDoc?.id));
  // An entry beyond the window (written directly, as only ROOT could).
  const autoEntries = Number((await pg.query(`select count(*) from "JournalDocumentEntry" where "documentId"=$1`, [autoDoc.id])).rows[0].count);
  info("auto doc entries right after creation", String(autoEntries));
  const oldId = (await pg.query(`insert into "JournalDocumentEntry"(id, "documentId", "employeeId", date, data, "createdAt", "updatedAt") values($1,$2,$3,$4::date,$5::jsonb,now(),now()) on conflict ("documentId", "employeeId", date) do update set "updatedAt"=now() returning id`, [`verif_old_${Date.now()}`, autoDoc.id, COOK.cookId, dayKey(-9), JSON.stringify(data)])).rows[0].id;
  const patch = (date) => ownerApi.patch(`${BASE}/api/journal-documents/${autoDoc.id}/entries`, { data: { entries: [{ employeeId: COOK.cookId, date, data }] } });
  // Window 7 is on.
  r = await res(await cookPut(autoDoc.id, dayKey(-1)));
  check("V6 auto doc + window: cook yesterday own row → 200", r.status === 200, `${r.status} ${r.body.error ?? ""}`);
  r = await res(await ownerPut(autoDoc.id, dayKey(-8)));
  check("V6 auto doc: owner PUT 8 days ago → 403 past_day_locked", r.status === 403 && r.body.code === "past_day_locked", `${r.status} ${r.body.code ?? ""}`);
  r = await res(await patch(dayKey(-2)));
  check("V6 auto doc: owner PATCH 2 days ago (window) → 200", r.status === 200, `${r.status} ${r.body.error ?? ""}`);
  r = await res(await patch(dayKey(-8)));
  check("V6 auto doc: owner PATCH 8 days ago → 403", r.status === 403 && r.body.code === "past_day_locked", `${r.status} ${r.body.code ?? ""}`);
  r = await res(await ownerApi.delete(`${BASE}/api/journal-documents/${autoDoc.id}/entries`, { data: { ids: [oldId] } }));
  check("V6 auto doc: owner DELETE entry 9 days ago → 403", r.status === 403, `${r.status} ${r.body.error ?? ""}`);
  const yId = (await pg.query(`select id from "JournalDocumentEntry" where "documentId"=$1 and date=$2::date`, [autoDoc.id, dayKey(-2)])).rows[0]?.id;
  r = await res(await ownerApi.delete(`${BASE}/api/journal-documents/${autoDoc.id}/entries`, { data: { ids: [yId] } }));
  check("V6 auto doc: owner DELETE entry 2 days ago (window) → 200", r.status === 200 && r.body.deleted === 1, `${r.status} ${JSON.stringify(r.body)}`);
  // Special mode off → as before: automation lock for everybody.
  await setAutomation({ ...OFF, enabled: false, pastDays: true, pastDaysLimit: 7 });
  r = await res(await patch(dayKey(-2)));
  check("V6 auto doc, special mode off: owner PATCH 2 days ago → 403", r.status === 403, `${r.status} ${r.body.code ?? ""}`);
  r = await res(await ownerPut(autoDoc.id, dayKey(-1)));
  check("V6 auto doc, special mode off: owner PUT yesterday → 403", r.status === 403 && r.body.code === "past_day_locked", `${r.status} ${r.body.code ?? ""}`);

  // ---------- V7: dark theme look of the card and the dialog ----------
  await setAutomation({ ...OFF, enabled: true, autoFill: true, pastDays: true, pastDaysLimit: 14 });
  const darkContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU", colorScheme: "dark" });
  await darkContext.addCookies([...(await ownerContext.cookies()), { name: "wesetup-theme", value: "dark", url: BASE }]);
  const dark = await darkContext.newPage();
  dark.on("pageerror", (error) => errors.push(`dark: ${error.message}`));
  await open(dark, "/settings/organization");
  const darkCard = dark.locator("[data-inspection-special-mode]");
  await darkCard.scrollIntoViewIfNeeded();
  const chip = (await darkCard.locator("[data-special-mode-visible]").innerText()).replace(/\s+/g, " ");
  check("V7 card chip shows 14 days", /Правка прошлых дней: 14 дней/.test(chip), chip.slice(0, 160));
  await darkCard.screenshot({ path: `${OUT}/v7-dark-org-card.png` });
  await darkCard.locator("[data-special-mode-change]").click();
  const darkDialog = dark.locator("[data-special-mode-dialog]");
  await darkDialog.waitFor({ timeout: 15000 });
  const sel = darkDialog.locator("[data-special-mode-past-days-limit]");
  const selStyle = await sel.evaluate((el) => { const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundColor }; });
  info("V7 dark: «Насколько назад» select colours", JSON.stringify(selStyle));
  await darkDialog.screenshot({ path: `${OUT}/v7-dark-dialog.png` });
  await dark.keyboard.press("Escape");
  const hint = await dark.locator("text=Спецрежим разрешает правку прошлых дней").first().innerText().catch(() => "");
  check("V7 org lock hint for 14 days", /последние 14 дней/.test(hint), hint.slice(0, 160));
  await darkContext.close();

} catch (error) {
  console.error("SCENARIO ERROR", error);
  check("scenario ran to the end", false, String(error?.message ?? error));
} finally {
  if (autoPointId) await pg.query(`update "Building" set "journalAutomationJson"=null where id=$1`, [autoPointId]);
  for (const id of docIds) await pg.query(`delete from "JournalDocumentEntry" where "documentId"=$1`, [id]);
  await restoreSetting();
  await pg.query(`update "Organization" set "lockPastDayEdits"=$2 where id=$1`, [ORG, orgRow.lockPastDayEdits]);
  const after = (await pg.query(`select value from "PlatformSetting" where key=$1`, [KEY])).rows[0]?.value ?? null;
  check("restore: special-mode setting back to raw start value", after === rawSetting, after);
  await pg.end();
  await browser.close();
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" || "));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((x) => !x.info && !x.ok).length;
console.log(`\n${results.filter((x) => !x.info).length - failed}/${results.filter((x) => !x.info).length} PASS`);
process.exit(failed ? 1 : 0);
