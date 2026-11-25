// Fresh verifier (round 2) stand checks for special-mode-past-days-2026-11-25.
// Usage (repo root, env loaded): node verifier2-e2e.mjs <out-dir> <point-manager.json>
// Restores at the end: special-mode PlatformSetting (raw value), Organization.lockPastDayEdits,
// own point automation JSON and own document autoFill. Own point/documents stay as stand data.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/home/user/HASSR-Online/package.json");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2];
const PM = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (id, name, ok, detail = "") => {
  results.push({ id, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
};
const info = (id, name, detail) => {
  results.push({ id, name, info: true, detail });
  console.log(`INFO [${id}] ${name} — ${detail}`);
};
const errors = [];

const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const q = async (sql, params = []) => (await pg.query(sql, params)).rows;
const user = async (email) => (await q(`select id, "organizationId" from "User" where email=$1`, [email]))[0];
const ADMIN = await user("admin@haccp.local");
const COOK = await user("cook-e2e-special@haccp.local");
const VERIFY = await user("verify-e2e-special@haccp.local");
const ORG = ADMIN.organizationId;
const KEY = `org-journal-controls:${ORG}`;
const rawSetting = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
const orgRow = (await q(`select "lockPastDayEdits", timezone, "shiftEndHour", "perLocationJournals" from "Organization" where id=$1`, [ORG]))[0];
info("setup", "raw special-mode setting at start", rawSetting);
info("setup", "org at start", JSON.stringify(orgRow));

async function restoreSetting() {
  if (rawSetting === null) await q(`delete from "PlatformSetting" where key=$1`, [KEY]);
  else await q(`insert into "PlatformSetting"(key, value, "updatedAt") values($1,$2,now()) on conflict(key) do update set value=excluded.value, "updatedAt"=now()`, [KEY, rawSetting]);
}

const dayKey = (offset) => {
  const msk = new Date(Date.now() + 3 * 3600 * 1000);
  msk.setUTCDate(msk.getUTCDate() + offset);
  return msk.toISOString().slice(0, 10);
};
const today = dayKey(0);
const monthStart = `${today.slice(0, 8)}01`;
const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
info("setup", "org today (Moscow)", `${today}; month ${monthStart}..${monthEnd}`);
if (dayKey(-9) < monthStart) throw new Error("this scenario needs today >= 10th of the month (moves 9 days back inside one monthly document)");

async function login(context, email, password) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${email}: ${error.message}`));
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 60000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
  return page;
}
async function open(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 180000 });
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.count()) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "detached", timeout: 30000 });
  }
}
const json = async (res) => res.json().catch(() => ({}));

const browser = await chromium.launch();
const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const owner = await login(ownerCtx, "admin@haccp.local", "admin1234");
const ownerApi = ownerCtx.request;
const cookCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const cookPage = await login(cookCtx, "cook-e2e-special@haccp.local", "cook-e2e-2026");
const cookApi = cookCtx.request;

const OFF = { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 };
async function setAutomation(automation) {
  const res = await ownerApi.patch(`${BASE}/api/settings/journal-controls`, { data: { automation } });
  const body = await json(res);
  if (!res.ok()) throw new Error(`PATCH journal-controls ${res.status()} ${JSON.stringify(body)}`);
  return body.automation;
}
const getControls = async (api = ownerApi) => (await json(await api.get(`${BASE}/api/settings/journal-controls`))).automation;

let ownPointId = null;
let hygieneDocId = null;
try {
  // ===================== AC1: «Пришла проверка» =====================
  await setAutomation(OFF);
  await open(owner, "/inspection");
  const menuSpecial = owner.locator('a[href="/inspection/settings"]').filter({ hasText: "Спецрежим" });
  check("AC1-1", "owner: section menu has «Спецрежим» → /inspection/settings", (await menuSpecial.count()) >= 1, `count=${await menuSpecial.count()}`);
  const inspCard = owner.locator("[data-inspection-special-mode]");
  check("AC1-2", "owner /inspection: special-mode card at the bottom, switch enabled, no quiet link",
    (await inspCard.count()) === 1 && (await inspCard.locator('button[role="switch"]').isEnabled()) && (await owner.locator("[data-inspection-settings-link]").count()) === 0);
  await owner.screenshot({ path: `${OUT}/a1-owner-inspection.png`, fullPage: true });
  await open(owner, "/inspection/settings");
  const ownerH1 = (await owner.locator("h1").first().innerText().catch(() => "")).trim();
  check("AC1-3", "owner /inspection/settings: title «Спецрежим», card with enabled switch, no access-denied",
    ownerH1 === "Спецрежим" && (await owner.locator("[data-inspection-special-mode] button[role=switch]").isEnabled()) && (await owner.locator("[data-access-denied]").count()) === 0, ownerH1);

  // tasks.verify user (role cook + preset head_chef, no admin.full): the quiet link path.
  const verifyCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const verifyPage = await login(verifyCtx, "verify-e2e-special@haccp.local", "verify-e2e-2026");
  await open(verifyPage, "/inspection");
  check("AC1-4", "tasks.verify /inspection: no card, quiet link «Настройки раздела» present",
    (await verifyPage.locator("[data-inspection-special-mode]").count()) === 0 && (await verifyPage.locator("[data-inspection-settings-link]").count()) === 1,
    (await verifyPage.locator("[data-inspection-settings-link]").innerText().catch(() => "")).trim());
  check("AC1-5", "tasks.verify: no «Спецрежим» item in the section menu",
    (await verifyPage.locator('a[href="/inspection/settings"]').filter({ hasText: "Спецрежим" }).count()) === 0);
  await verifyPage.locator("[data-inspection-settings-link]").click();
  await verifyPage.waitForURL((u) => u.pathname === "/inspection/settings", { timeout: 120000 });
  await verifyPage.waitForLoadState("networkidle");
  await verifyPage.locator("[data-inspection-special-mode]").first().waitFor({ timeout: 60000 }).catch(() => {});
  const vCard = verifyPage.locator("[data-inspection-special-mode]");
  const vH1 = (await verifyPage.locator("h1").first().innerText().catch(() => "")).trim();
  const vSwitch = vCard.locator('button[role="switch"]');
  check("AC1-6", "tasks.verify: quiet link opens the page (not «Нет доступа»), title «Спецрежим», read-only card + «попросите руководителя»",
    (await verifyPage.locator("[data-access-denied]").count()) === 0 && (await vCard.count()) === 1 && vH1 === "Спецрежим" &&
      (await vSwitch.count()) === 1 && !(await vSwitch.isEnabled()) &&
      (await vCard.innerText()).includes("Включить, выключить или изменить режим может руководитель — попросите его."),
    `h1=${vH1}`);
  await verifyPage.screenshot({ path: `${OUT}/a1-verify-settings-page.png`, fullPage: true });
  const vPatch = await verifyCtx.request.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { ...OFF, enabled: true, autoFill: true } } });
  check("AC1-7", "tasks.verify: PATCH journal-controls refused (403), as before", vPatch.status() === 403, String(vPatch.status()));
  const vOrg = await verifyCtx.request.get(`${BASE}/settings/organization`, { maxRedirects: 0 });
  info("AC1-8", "tasks.verify GET /settings/organization status (admin.full page, as before)", String(vOrg.status()));
  await verifyCtx.close();

  // cook (no tasks.verify): page closed as before.
  await open(cookPage, "/inspection/settings");
  const cookDenied = (await cookPage.locator("[data-access-denied]").count()) > 0 || (await cookPage.locator("[data-inspection-special-mode]").count()) === 0;
  check("AC1-9", "cook: /inspection/settings stays closed (no special-mode card)", cookDenied && (await cookPage.locator("[data-inspection-special-mode]").count()) === 0, cookPage.url());

  // ===================== AC2: point manager (admin.full but point-scoped) =====================
  const pmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const pmPage = await login(pmCtx, PM.email, PM.password);
  const pmPatch = await pmCtx.request.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { ...OFF, enabled: true, pastDays: true, pastDaysLimit: 30 } } });
  const pmPatchBody = await json(pmPatch);
  check("AC2-1", "point manager: PATCH journal-controls 403 (company-only, as before)", pmPatch.status() === 403, `${pmPatch.status()} ${pmPatchBody.error ?? ""}`);
  await open(pmPage, "/inspection");
  check("AC2-2", "point manager /inspection: no managing card (quiet link instead)",
    (await pmPage.locator("[data-inspection-special-mode]").count()) === 0 && (await pmPage.locator("[data-inspection-settings-link]").count()) === 1);
  await open(pmPage, "/inspection/settings");
  const pmSwitch = pmPage.locator("[data-inspection-special-mode] button[role=switch]");
  check("AC2-3", "point manager /inspection/settings: card read-only (switch disabled)", (await pmSwitch.count()) === 1 && !(await pmSwitch.isEnabled()));
  await open(pmPage, "/settings/organization");
  const pmOrgSwitch = pmPage.locator("[data-inspection-special-mode] button[role=switch]");
  const pmOrgState = (await pmOrgSwitch.count()) === 0 ? "no card (company page closed)" : (await pmOrgSwitch.isEnabled()) ? "switch ENABLED" : "switch disabled";
  check("AC2-4", "point manager /settings/organization: no enabled switch", !(pmOrgState === "switch ENABLED"), `${pmOrgState}; url=${pmPage.url()}`);
  await pmCtx.close();

  // ===================== AC3: first «Включить» dialog for an org with no previous choice =====================
  await setAutomation(OFF);
  const firstOpen = async (page, url, shot) => {
    await open(page, url);
    const card = page.locator("[data-inspection-special-mode]").first();
    await card.locator('button[role="switch"]').click();
    const dialog = page.locator("[data-special-mode-dialog]");
    await dialog.waitFor({ timeout: 30000 });
    const states = await dialog.locator("[data-special-mode-option]").evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((node) => [node.getAttribute("data-special-mode-option"), node.getAttribute("data-state")])));
    const limitShown = await dialog.locator("[data-special-mode-past-days-limit]").count();
    if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
    return { dialog, states, limitShown };
  };
  for (const [i, url] of ["/inspection", "/settings/organization", "/inspection/settings"].entries()) {
    const { dialog, states, limitShown } = await firstOpen(owner, url, `b-first-dialog-${i}.png`);
    const autoChecked = ["autoFill", "autoCreate", "copyYesterday", "closeDayAutofill", "catchUp"].every((f) => states[f] === "checked");
    check(`AC3-1.${i}`, `first «Включить» dialog on ${url}: automation ticked, «Правка прошлых дней» NOT ticked, no limit select`,
      autoChecked && states.pastDays === "unchecked" && limitShown === 0, JSON.stringify(states));
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await dialog.waitFor({ state: "detached", timeout: 15000 });
  }
  const afterCancel = await getControls();
  check("AC3-2", "cancelling the first dialog saves nothing", afterCancel.enabled === false && afterCancel.pastDays === false, JSON.stringify(afterCancel));

  // Enable from «Пришла проверка» with the box ticked by hand, 3 days.
  {
    const { dialog } = await firstOpen(owner, "/inspection");
    await dialog.locator('[data-special-mode-option="pastDays"]').click();
    const select = dialog.locator("[data-special-mode-past-days-limit]");
    const options = await select.locator("option").evaluateAll((nodes) => nodes.map((n) => `${n.value}:${n.textContent}`));
    check("AC3-3", "«Насколько назад» appears when ticked: 6 options, default 7", options.length === 6 && (await select.inputValue()) === "7", options.join(" | "));
    await select.selectOption("3");
    await owner.screenshot({ path: `${OUT}/b-dialog-3-days.png` });
    await dialog.locator("[data-special-mode-confirm]").click();
    await dialog.waitFor({ state: "detached", timeout: 30000 });
    await owner.waitForTimeout(1000);
  }
  const saved3 = await getControls();
  check("AC3-4", "saved: enabled, pastDays true, pastDaysLimit 3", saved3.enabled === true && saved3.pastDays === true && saved3.pastDaysLimit === 3, JSON.stringify(saved3));
  const chips = (await owner.locator("[data-inspection-special-mode] [data-special-mode-visible]").innerText()).replace(/\s+/g, " ");
  check("AC3-5", "card on /inspection shows «Правка прошлых дней: 3 дня» and «Изменить»",
    chips.includes("Правка прошлых дней: 3 дня") && (await owner.locator("[data-inspection-special-mode] [data-special-mode-change]").count()) === 1, chips.slice(0, 220));
  await owner.screenshot({ path: `${OUT}/b-inspection-on.png`, fullPage: true });
  // AC2: changed in «Пришла проверка» → visible in «Информация об организации» (+ hint under the org lock).
  await open(owner, "/settings/organization");
  const orgChips = (await owner.locator("[data-inspection-special-mode] [data-special-mode-visible]").innerText()).replace(/\s+/g, " ");
  const hint3 = await owner.getByText("Спецрежим разрешает правку прошлых дней", { exact: false }).first().innerText().catch(() => "");
  check("AC2-5", "set in «Пришла проверка» → «Информация об организации» card shows 3 days + hint «за последние 3 дня»",
    orgChips.includes("Правка прошлых дней: 3 дня") && hint3.includes("за последние 3 дня — на эти дни запрет не действует."), `${orgChips.slice(0, 120)} || ${hint3}`);
  // «Изменить» there: previous choice (box ticked, 3) → change to 1 day.
  await owner.locator("[data-inspection-special-mode] [data-special-mode-change]").click();
  const chDialog = owner.locator("[data-special-mode-dialog]");
  await chDialog.waitFor({ timeout: 30000 });
  check("AC3-6", "«Изменить» opens the saved choice (box ticked, 3 days)",
    (await chDialog.locator('[data-special-mode-option="pastDays"]').getAttribute("data-state")) === "checked" && (await chDialog.locator("[data-special-mode-past-days-limit]").inputValue()) === "3");
  await chDialog.locator("[data-special-mode-past-days-limit]").selectOption("1");
  await chDialog.locator("[data-special-mode-confirm]").click();
  await chDialog.waitFor({ state: "detached", timeout: 30000 });
  await owner.waitForTimeout(800);
  const hint1 = await owner.getByText("Спецрежим разрешает правку прошлых дней", { exact: false }).first().innerText().catch(() => "");
  check("AC3-7", "hint follows the change: «за последний 1 день»", hint1.includes("за последний 1 день"), hint1);
  await open(owner, "/inspection/settings");
  const pageChips = (await owner.locator("[data-inspection-special-mode] [data-special-mode-visible]").innerText()).replace(/\s+/g, " ");
  check("AC2-6", "changed in «Информация об организации» → «Спецрежим» page shows «Правка прошлых дней: 1 день»", pageChips.includes("Правка прошлых дней: 1 день"), pageChips.slice(0, 200));
  // Off and on again: the dialog brings back the previous choice (with the box), cancel keeps it off.
  await owner.locator("[data-inspection-special-mode] button[role=switch]").click();
  await owner.getByRole("button", { name: "Выключить" }).click();
  await owner.waitForTimeout(1200);
  const offKept = await getControls();
  check("AC3-8", "switch off: mode off, choice kept (pastDays true, 1 day)", offKept.enabled === false && offKept.pastDays === true && offKept.pastDaysLimit === 1, JSON.stringify(offKept));
  {
    await owner.locator("[data-inspection-special-mode] button[role=switch]").click();
    const dialog = owner.locator("[data-special-mode-dialog]");
    await dialog.waitFor({ timeout: 30000 });
    const st = await dialog.locator('[data-special-mode-option="pastDays"]').getAttribute("data-state");
    const lim = await dialog.locator("[data-special-mode-past-days-limit]").inputValue().catch(() => "");
    check("AC3-9", "re-enable dialog: previous choice (box ticked, 1 day)", st === "checked" && lim === "1", `${st} ${lim}`);
    await dialog.getByRole("button", { name: "Отмена" }).click();
  }

  // AC3 stored defaults via DB: a saved choice without the key, and no saved setting at all.
  await q(`update "PlatformSetting" set value=$2 where key=$1`, [KEY, JSON.stringify({ automation: { enabled: true, autoFill: true, autoCreate: true, copyYesterday: true, closeDayAutofill: true, catchUp: true }, sensorCamera: {}, brakerageSetup: {} })]);
  const legacy = await getControls();
  check("AC3-10", "saved choice without the key → pastDays false (others kept), limit 7", legacy.enabled && legacy.autoFill && legacy.pastDays === false && legacy.pastDaysLimit === 7, JSON.stringify(legacy));
  await q(`delete from "PlatformSetting" where key=$1`, [KEY]);
  const none = await getControls();
  check("AC3-11", "no saved setting (org created after 2026-10-28) → off, pastDays false", none.enabled === false && none.pastDays === false, JSON.stringify(none));
  await restoreSetting();

  // ===================== AC4: staff writes around the window (own point, own documents) =====================
  const pointName = `Кафе e2e верификатор-2 ${new Date().toISOString().slice(11, 19)}`;
  const pointRes = await ownerApi.post(`${BASE}/api/settings/buildings`, { data: { name: pointName, sphere: "food" } });
  ownPointId = (await json(pointRes)).building?.id ?? null;
  check("setup-1", `own point «${pointName}»`, pointRes.ok() && ownPointId, String(pointRes.status()));
  await ownerApi.post(`${BASE}/api/me/active-building`, { data: { buildingId: ownPointId } });
  await cookApi.post(`${BASE}/api/me/active-building`, { data: { buildingId: ownPointId } });
  const created = await ownerApi.post(`${BASE}/api/journal-documents`, { data: { templateCode: "hygiene", title: `Гигиена верификатор-2 ${today}`, dateFrom: monthStart, dateTo: monthEnd } });
  hygieneDocId = (await json(created)).document?.id ?? null;
  const coldCreated = await ownerApi.post(`${BASE}/api/journal-documents`, { data: { templateCode: "cold_equipment_control", title: `Холодильники верификатор-2 ${today}`, dateFrom: monthStart, dateTo: monthEnd } });
  const coldDocId = (await json(coldCreated)).document?.id ?? null;
  check("setup-2", "own hygiene + cold documents for the month", created.ok() && hygieneDocId && coldCreated.ok() && coldDocId, `${created.status()} ${coldCreated.status()}`);
  const stubCount = (await q(`select count(*)::int n from "JournalDocumentEntry" where "documentId"=$1`, [hygieneDocId]))[0].n;
  info("setup-3", "entries pre-created in the hygiene document", String(stubCount));

  const DATA = { status: "day_off", temperatureAbove37: null };
  const url = `${BASE}/api/journal-documents/${hygieneDocId}/entries`;
  const put = async (api, employeeId, date, extra = {}) => {
    const res = await api.put(url, { data: { employeeId, date, data: DATA, ...extra } });
    return { status: res.status(), body: await json(res) };
  };
  const bulk = async (api, items) => {
    const res = await api.post(`${url}/bulk`, { data: { items: items.map(([employeeId, date]) => ({ employeeId, date, data: DATA })) } });
    return { status: res.status(), body: await json(res) };
  };
  const del = async (employeeId, date) => (await ownerApi.delete(url, { data: { employeeId, date } })).status();
  const row = async (id) => (await q(`select "employeeId", to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where id=$1`, [id]))[0] ?? null;
  const at = async (employeeId, d) => (await q(`select id from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2 and date=$3::date`, [hygieneDocId, employeeId, d]))[0]?.id ?? null;
  const fmt = (r) => `${r.status} ${r.body.code ?? ""} ${r.body.error ?? ""}`.trim();
  const NOT_TODAY = "Заполнять можно только сегодняшний день. За прошлые дни правки вносит ответственный за журнал.";
  const ON3 = { ...OFF, enabled: true, pastDays: true, pastDaysLimit: 3 };

  // Mode off first: as before.
  await setAutomation(OFF);
  let r = await put(cookApi, COOK.id, dayKey(-1));
  check("AC4-1", "mode off: staff yesterday → 403 «только сегодня»", r.status === 403 && r.body.code === "not_today" && r.body.error === NOT_TODAY, fmt(r));
  r = await put(cookApi, COOK.id, today);
  check("AC4-2", "mode off: staff today → 200", r.status === 200, fmt(r));
  r = await put(cookApi, COOK.id, `${today}T00:00:00+14:00`);
  check("AC4-3", "mode off: «today+14:00» (written as yesterday) → 403", r.status === 403, fmt(r));

  await setAutomation(ON3);
  r = await put(cookApi, COOK.id, dayKey(-1));
  const cookYesterdayId = r.body.entry?.id;
  check("AC4-4", "window 3: staff own row yesterday → 200", r.status === 200 && cookYesterdayId, fmt(r));
  r = await put(cookApi, COOK.id, dayKey(-3));
  check("AC4-5", "window 3: 3 days ago (boundary) → 200", r.status === 200, fmt(r));
  r = await put(cookApi, COOK.id, dayKey(-4));
  check("AC4-6", "window 3: 4 days ago → 403 «за последние 3 дня»", r.status === 403 && r.body.error === "Прошлые записи можно менять только за последние 3 дня.", fmt(r));
  r = await put(cookApi, COOK.id, dayKey(1));
  check("AC4-7", "window 3: tomorrow → 403", r.status === 403, fmt(r));
  r = await put(cookApi, ADMIN.id, dayKey(-1));
  check("AC4-8", "window 3: colleague's row yesterday → 403 foreign_row", r.status === 403 && r.body.code === "foreign_row", fmt(r));
  // Timestamps with offsets: the checked day is the day that is written.
  r = await put(cookApi, COOK.id, `${dayKey(-2)}T00:00:00+14:00`);
  check("AC4-9", "«2 days ago T00:00+14:00» → written 3 days ago → 200", r.status === 200 && String(r.body.entry?.date ?? "").startsWith(dayKey(-3)), `${fmt(r)} date=${r.body.entry?.date}`);
  r = await put(cookApi, COOK.id, `${dayKey(-3)}T00:00:00+14:00`);
  check("AC4-10", "«3 days ago T00:00+14:00» → would be 4 days ago → 403", r.status === 403 && r.body.code === "not_today", fmt(r));
  r = await put(cookApi, COOK.id, `${dayKey(-4)}T23:00:00-05:00`);
  check("AC4-11", "«4 days ago T23:00-05:00» → written 3 days ago → 200", r.status === 200 && String(r.body.entry?.date ?? "").startsWith(dayKey(-3)), `${fmt(r)} date=${r.body.entry?.date}`);
  r = await put(cookApi, COOK.id, `${today}T22:00:00-05:00`);
  check("AC4-12", "«today T22:00-05:00» → tomorrow → 403", r.status === 403, fmt(r));
  r = await put(cookApi, COOK.id, "not-a-date");
  check("AC4-13", "unparsable date → 400", r.status === 400, fmt(r));
  // Bulk (painting).
  r = await bulk(cookApi, [[COOK.id, dayKey(-1)], [COOK.id, dayKey(-2)]]);
  check("AC4-14", "bulk window 3: own yesterday + 2 days ago → saved 2", r.status === 200 && r.body.saved === 2, JSON.stringify(r.body));
  r = await bulk(cookApi, [[COOK.id, dayKey(-1)], [COOK.id, dayKey(-4)]]);
  check("AC4-15", "bulk window 3: stroke reaching 4 days ago → 403", r.status === 403 && /последние 3 дня/.test(r.body.error ?? ""), fmt(r));
  r = await bulk(cookApi, [[COOK.id, `${dayKey(-3)}T00:00:00+14:00`]]);
  check("AC4-16", "bulk: «3 days ago+14:00» (written 4 days ago) → 403", r.status === 403, fmt(r));
  r = await bulk(cookApi, [[COOK.id, `${dayKey(-2)}T00:00:00+14:00`]]);
  const bulkRowAt3 = await at(COOK.id, dayKey(-3));
  check("AC4-17", "bulk: «2 days ago+14:00» → saved on 3 days ago", r.status === 200 && r.body.saved === 1 && bulkRowAt3, JSON.stringify(r.body));
  r = await bulk(cookApi, [[ADMIN.id, dayKey(-1)]]);
  check("AC4-18", "bulk: colleague's row → 403 foreign_row", r.status === 403 && r.body.code === "foreign_row", fmt(r));
  // Window 1 and no limit.
  await setAutomation({ ...ON3, pastDaysLimit: 1 });
  r = await put(cookApi, COOK.id, dayKey(-1));
  check("AC4-19", "window 1: yesterday → 200", r.status === 200, fmt(r));
  r = await put(cookApi, COOK.id, dayKey(-2));
  check("AC4-20", "window 1: 2 days ago → 403 «только за вчерашний день»", r.status === 403 && r.body.error === "Прошлые записи можно менять только за вчерашний день.", fmt(r));
  await setAutomation({ ...ON3, pastDaysLimit: 0 });
  const farDay = dayKey(-20) < monthStart ? monthStart : dayKey(-20);
  r = await put(cookApi, COOK.id, farDay);
  check("AC4-21", `no limit: ${farDay} → 200`, r.status === 200, fmt(r));
  r = await put(cookApi, COOK.id, dayKey(1));
  check("AC4-22", "no limit: tomorrow still 403", r.status === 403, fmt(r));
  // Box ticked but mode off; mode on but box unticked → as before.
  await setAutomation({ ...ON3, enabled: false });
  r = await put(cookApi, COOK.id, dayKey(-1));
  check("AC4-23", "box ticked, mode OFF: yesterday → 403 «только сегодня»", r.status === 403 && r.body.error === NOT_TODAY, fmt(r));
  await setAutomation({ ...ON3, pastDays: false, autoFill: true });
  r = await put(cookApi, COOK.id, dayKey(-1));
  check("AC4-24", "mode on, box unticked: yesterday → 403", r.status === 403 && r.body.code === "not_today", fmt(r));

  // ===================== Entry moves via entryId =====================
  await setAutomation(ON3);
  // E1: colleague's entry → own row.
  r = await put(ownerApi, ADMIN.id, dayKey(-1));
  const ownerEntry = r.body.entry?.id;
  r = await put(cookApi, COOK.id, dayKey(-1), { entryId: ownerEntry });
  let src = await row(ownerEntry);
  check("MV-1", "staff moves a colleague's yesterday entry onto own row → 403 foreign_row, entry untouched",
    r.status === 403 && r.body.code === "foreign_row" && src?.employeeId === ADMIN.id && src?.d === dayKey(-1), `${fmt(r)} src=${JSON.stringify(src)}`);
  // E2: own entry beyond the window → into the window.
  r = await put(ownerApi, COOK.id, dayKey(-6));
  const oldCookEntry = r.body.entry?.id;
  await del(COOK.id, dayKey(-2));
  r = await put(cookApi, COOK.id, dayKey(-2), { entryId: oldCookEntry });
  src = await row(oldCookEntry);
  check("MV-2", "staff moves own entry from 6 days ago (beyond window 3) to 2 days ago → 403 window text, untouched",
    r.status === 403 && /последние 3 дня/.test(r.body.error ?? "") && src?.d === dayKey(-6), `${fmt(r)} src=${JSON.stringify(src)}`);
  // E3: inside the window → 200.
  const y = await at(COOK.id, dayKey(-1));
  await del(COOK.id, dayKey(-2));
  r = await put(cookApi, COOK.id, dayKey(-2), { entryId: y });
  src = await row(y);
  check("MV-3", "staff moves own yesterday entry to 2 days ago (both in window) → 200, same row moved",
    r.status === 200 && r.body.entry?.id === y && src?.d === dayKey(-2) && !(await at(COOK.id, dayKey(-1))), `${fmt(r)} src=${JSON.stringify(src)}`);
  // E4: target in the future.
  r = await put(cookApi, COOK.id, dayKey(1), { entryId: y });
  check("MV-4", "staff moves own entry to tomorrow → 403", r.status === 403 && (await row(y))?.d === dayKey(-2), fmt(r));
  // E5: plain edit with entryId (same employee/day) — no regression.
  const todayId = await at(COOK.id, today);
  r = await put(cookApi, COOK.id, today, { entryId: todayId });
  check("MV-5", "plain edit with entryId (same cell) → 200", r.status === 200 && r.body.entry?.id === todayId, fmt(r));
  // E6: entryId of another document → 404, nothing moved.
  const foreignDocEntry = (await q(`select id from "JournalDocumentEntry" where "documentId"<>$1 limit 1`, [hygieneDocId]))[0]?.id;
  r = await put(ownerApi, ADMIN.id, today, { entryId: foreignDocEntry });
  check("MV-6", "entryId from another document → 404 «Строка не найдена в этом документе»", r.status === 404, fmt(r));
  // E7: mode off → staff cannot move a yesterday entry (written by the owner) to today.
  await setAutomation({ ...ON3, enabled: false });
  r = await put(ownerApi, COOK.id, dayKey(-1));
  const yOwnerWritten = r.body.entry?.id;
  await del(COOK.id, today);
  r = await put(cookApi, COOK.id, today, { entryId: yOwnerWritten });
  src = await row(yOwnerWritten);
  check("MV-7", "mode off: staff moves own-row yesterday entry to today → 403 not_today (source), untouched",
    r.status === 403 && r.body.code === "not_today" && src?.d === dayKey(-1), `${fmt(r)} src=${JSON.stringify(src)}`);
  // E8: management + «Запретить редактирование…»: move beyond window → 200 with override audit of target AND source.
  await setAutomation(ON3);
  await q(`update "Organization" set "lockPastDayEdits"=true where id=$1`, [ORG]);
  await del(COOK.id, dayKey(-5));
  const auditBefore = (await q(`select count(*)::int n from "AuditLog" where "organizationId"=$1 and action='closed_day.override' and "entityId"=$2`, [ORG, hygieneDocId]))[0].n;
  r = await put(ownerApi, COOK.id, dayKey(-5), { entryId: oldCookEntry });
  const audits = await q(`select details from "AuditLog" where "organizationId"=$1 and action='closed_day.override' and "entityId"=$2 order by "createdAt" desc`, [ORG, hygieneDocId]);
  const lastDates = audits[0]?.details?.dates ?? [];
  check("MV-8", "org lock: owner moves 6 days ago → 5 days ago (beyond window) → 200; one override audit with both days",
    r.status === 200 && audits.length === auditBefore + 1 && lastDates.some((d) => d.startsWith(dayKey(-5))) && lastDates.some((d) => d.startsWith(dayKey(-6))),
    `${fmt(r)} dates=${JSON.stringify(lastDates)}`);
  r = await put(cookApi, COOK.id, dayKey(-1));
  check("MV-9", "org lock + window 3: staff own yesterday → 200 (lock does not apply in the window)", r.status === 200, fmt(r));
  r = await put(cookApi, COOK.id, dayKey(-5));
  check("MV-10", "org lock + window 3: staff 5 days ago → 403", r.status === 403, fmt(r));
  const auditMid = (await q(`select count(*)::int n from "AuditLog" where "organizationId"=$1 and action='closed_day.override' and "entityId"=$2`, [ORG, hygieneDocId]))[0].n;
  const inWin = await at(COOK.id, dayKey(-1));
  await del(COOK.id, dayKey(-3));
  r = await put(ownerApi, COOK.id, dayKey(-3), { entryId: inWin });
  const auditAfter = (await q(`select count(*)::int n from "AuditLog" where "organizationId"=$1 and action='closed_day.override' and "entityId"=$2`, [ORG, hygieneDocId]))[0].n;
  check("MV-11", "org lock: owner move inside the window → 200, no override audit", r.status === 200 && auditAfter === auditMid, `${fmt(r)} audits ${auditMid}→${auditAfter}`);
  await q(`update "Organization" set "lockPastDayEdits"=$2 where id=$1`, [ORG, orgRow.lockPastDayEdits]);
  // E9: management moving an entry OUT of a future day (entry created via PATCH, which has no future check).
  const futureDay = dayKey(2) <= monthEnd ? dayKey(2) : null;
  if (futureDay) {
    const patchRes = await ownerApi.patch(url, { data: { entries: [{ employeeId: ADMIN.id, date: futureDay, data: DATA }] } });
    const futureId = await at(ADMIN.id, futureDay);
    await del(ADMIN.id, today);
    r = await put(ownerApi, ADMIN.id, today, { entryId: futureId });
    info("MV-12", "owner moves an entry from a future day (created by PATCH) to today",
      `PATCH ${patchRes.status()}; move ${fmt(r)}; row now ${JSON.stringify(await row(futureId))}`);
    await ownerApi.delete(url, { data: { ids: [futureId].filter(Boolean) } });
  }

  // ===================== Automation document (journal led by automation) =====================
  // Prepare rows before the lock is on: owner row 6 and 2 days ago, cook row 2 days ago.
  await setAutomation(OFF);
  await put(ownerApi, ADMIN.id, dayKey(-6));
  await put(ownerApi, ADMIN.id, dayKey(-2));
  const a6 = await at(ADMIN.id, dayKey(-6));
  const a2 = await at(ADMIN.id, dayKey(-2));
  await q(`update "Building" set "journalAutomationJson"=$2::jsonb where id=$1`, [ownPointId, JSON.stringify({ hygiene: { autoCreate: true, autoFill: true } })]);
  await q(`update "JournalDocument" set "autoFill"=true where id=$1`, [hygieneDocId]);
  await setAutomation({ ...OFF, enabled: true, autoFill: true });
  r = await put(ownerApi, ADMIN.id, dayKey(-1));
  check("AD-1", "automation doc, box unticked: owner yesterday → 403 past_day_locked (lock active)", r.status === 403 && r.body.code === "past_day_locked", fmt(r));
  await setAutomation({ ...OFF, enabled: true, autoFill: true, pastDays: true, pastDaysLimit: 3 });
  r = await put(ownerApi, ADMIN.id, dayKey(-1));
  check("AD-2", "automation doc, window 3: owner yesterday → 200", r.status === 200, fmt(r));
  r = await put(cookApi, COOK.id, dayKey(-2));
  check("AD-3", "automation doc, window 3: staff own 2 days ago → 200", r.status === 200, fmt(r));
  r = await put(cookApi, COOK.id, dayKey(-4));
  check("AD-4", "automation doc, window 3: staff 4 days ago → 403", r.status === 403, fmt(r));
  await del(ADMIN.id, dayKey(-1)).catch(() => {});
  const freed = !(await at(ADMIN.id, dayKey(-1)));
  r = await put(ownerApi, ADMIN.id, dayKey(-1), { entryId: a6 });
  check("AD-5", "automation doc: owner moves 6 days ago (locked) → yesterday → 403 past_day_locked (source), untouched",
    r.status === 403 && r.body.code === "past_day_locked" && (await row(a6))?.d === dayKey(-6), `${fmt(r)} freedTarget=${freed}`);
  r = await put(ownerApi, ADMIN.id, dayKey(-1), { entryId: a2 });
  check("AD-6", "automation doc: owner moves 2 days ago → yesterday (both in window) → 200", r.status === 200 && (await row(a2))?.d === dayKey(-1), fmt(r));
  const delRes = await ownerApi.delete(url, { data: { ids: [a6] } });
  check("AD-7", "automation doc: owner deletes a row 6 days ago → 403 (as before)", delRes.status() === 403, String(delRes.status()));
  await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [ownPointId]);
  await q(`update "JournalDocument" set "autoFill"=false where id=$1`, [hygieneDocId]);

  // ===================== Grid (cold equipment) for staff: off vs window 3 =====================
  const notTodayTitle = NOT_TODAY;
  const windowTitle = "Прошлые записи можно менять только за последние 3 дня.";
  const gridCounts = async () => {
    await open(cookPage, `/journals/cold_equipment_control/documents/${coldDocId}`);
    await cookPage.waitForTimeout(2500);
    return cookPage.evaluate(([a, b]) => ({
      notToday: document.querySelectorAll(`[title="${a}"]`).length,
      window: document.querySelectorAll(`[title="${b}"]`).length,
    }), [notTodayTitle, windowTitle]);
  };
  await setAutomation(OFF);
  const gridOff = await gridCounts();
  await setAutomation(ON3);
  const gridOn = await gridCounts();
  await cookPage.screenshot({ path: `${OUT}/c-cook-cold-grid-window3.png`, fullPage: true });
  const daysBefore = Number(today.slice(8, 10)) - 1;
  const daysAfter = Number(monthEnd.slice(8, 10)) - Number(today.slice(8, 10));
  const k = gridOff.notToday / (daysBefore + daysAfter);
  check("GR-1", "staff grid: off → every non-today day closed «только сегодня»; window 3 → 3 days open, older days show the window text, future still closed",
    Number.isInteger(k) && k > 0 && gridOff.window === 0 && gridOn.window === (daysBefore - 3) * k && gridOn.notToday === daysAfter * k,
    JSON.stringify({ gridOff, gridOn, k, daysBefore, daysAfter }));
  await setAutomation(OFF);
  const gridOffAgain = await gridCounts();
  check("GR-2", "staff grid: mode off again → as before", gridOffAgain.notToday === gridOff.notToday && gridOffAgain.window === 0, JSON.stringify(gridOffAgain));
  await open(owner, "/settings/organization");
  const hintOff = await owner.getByText("Спецрежим разрешает правку прошлых дней", { exact: false }).count();
  check("GR-3", "mode off: no special-mode hint under «Запретить редактирование…»", hintOff === 0, String(hintOff));
} catch (error) {
  check("fatal", "scenario finished without exceptions", false, String(error?.stack ?? error).slice(0, 800));
} finally {
  if (ownPointId) await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [ownPointId]).catch(() => {});
  if (hygieneDocId) await q(`update "JournalDocument" set "autoFill"=false where id=$1`, [hygieneDocId]).catch(() => {});
  await q(`update "Organization" set "lockPastDayEdits"=$2 where id=$1`, [ORG, orgRow.lockPastDayEdits]).catch(() => {});
  await restoreSetting().catch(() => {});
  const restoredRaw = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
  const restoredOrg = (await q(`select "lockPastDayEdits" from "Organization" where id=$1`, [ORG]))[0];
  check("restore", "special mode and org lock restored", restoredRaw === rawSetting && restoredOrg.lockPastDayEdits === orgRow.lockPastDayEdits, `${restoredRaw} lock=${restoredOrg.lockPastDayEdits}`);
  check("errors", "no page errors", errors.length === 0, errors.slice(0, 3).join(" || "));
  fs.writeFileSync(`${OUT}/verifier2-e2e-results.json`, JSON.stringify({ today, results, errors }, null, 2));
  const failed = results.filter((x) => x.ok === false).length;
  const passed = results.filter((x) => x.ok === true).length;
  console.log(`\n${passed}/${passed + failed} PASS`);
  await browser.close();
  await pg.end();
  process.exit(failed ? 1 : 0);
}
