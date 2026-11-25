// Старые мелочи (2026-11-25) на стенде: AC1 удаление по сотруднику и дню, AC2 перенос из будущего дня,
// AC7 коды ошибок ППК и перевод в интерфейсе. Запуск: node run.mjs <outdir> (env: DATABASE_URL).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/home/user/HASSR-Online/package.json");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "out";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const q = async (sql, params = []) => (await pg.query(sql, params)).rows;
const dayKey = (offset) => { const d = new Date(Date.now() + 3 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const today = dayKey(0);
const ADMIN = (await q(`select id, "organizationId", locale from "User" where email='admin@haccp.local'`))[0];
const COOK = (await q(`select id from "User" where email='cook-e2e-special@haccp.local'`))[0];
const KEY = `org-journal-controls:${ADMIN.organizationId}`;
const rawSetting = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;

const browser = await chromium.launch();
async function login(email, password, locale) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: locale === "en" ? "en-US" : "ru-RU" });
  if (locale) await ctx.addCookies([{ name: "wesetup.site-locale", value: locale, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 120000 });
  await page.fill("#email", email); await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 }), page.click('button[type="submit"]')]);
  return { ctx, page, api: ctx.request };
}
const owner = await login("admin@haccp.local", "admin1234");
const cook = await login("cook-e2e-special@haccp.local", "cook-e2e-2026");
const DATA = { status: "day_off", temperatureAbove37: null };
let point = null; let doc = null;
const at = async (employeeId, d) => (await q(`select id, data::text from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2 and date=$3::date`, [doc.id, employeeId, d]))[0] ?? null;
try {
  // ---------- стенд: своя точка и документ гигиены на месяц ----------
  const pointRes = await owner.api.post(`${BASE}/api/settings/buildings`, { data: { name: `Кафе мелочи ${new Date().toISOString().slice(11, 19)}`, sphere: "food" } });
  point = (await pointRes.json().catch(() => ({}))).building;
  check("стенд: точка", pointRes.ok() && point?.id, String(pointRes.status()));
  for (const who of [owner, cook]) await who.api.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });
  const monthStart = `${today.slice(0, 8)}01`;
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const created = await owner.api.post(`${BASE}/api/journal-documents`, { data: { templateCode: "hygiene", title: `Гигиена мелочи ${today}`, dateFrom: monthStart, dateTo: monthEnd } });
  doc = (await created.json().catch(() => ({}))).document;
  check("стенд: документ гигиены", created.ok() && doc?.id, String(created.status()));
  const url = `${BASE}/api/journal-documents/${doc.id}/entries`;
  const OFF = { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 };
  await owner.api.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: OFF } });

  // ---------- AC1: удаление по сотруднику и дню в документе автоматики ----------
  for (const d of [-6, -1]) await owner.api.put(url, { data: { employeeId: ADMIN.id, date: dayKey(d), data: DATA } });
  await q(`update "Building" set "journalAutomationJson"=$2::jsonb where id=$1`, [point.id, JSON.stringify({ hygiene: { autoCreate: true, autoFill: true } })]);
  await q(`update "JournalDocument" set "autoFill"=true where id=$1`, [doc.id]);
  await owner.api.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { ...OFF, enabled: true, autoFill: true, pastDays: true, pastDaysLimit: 3 } } });
  let res = await owner.api.delete(url, { data: { employeeId: ADMIN.id, date: dayKey(-1) } });
  let body = await res.json().catch(() => ({}));
  check("AC1 документ автоматики, окно 3 дня: удаление строки за вчера по сотруднику и дню — 200 (раньше 403 из-за строки 6 дней назад)",
    res.status() === 200 && body.deleted === 1 && !(await at(ADMIN.id, dayKey(-1))), `${res.status()} ${JSON.stringify(body)}`);
  check("AC1 строка 6 дней назад не тронута", Boolean(await at(ADMIN.id, dayKey(-6))));
  res = await owner.api.delete(url, { data: { employeeId: ADMIN.id, date: dayKey(-6) } });
  body = await res.json().catch(() => ({}));
  check("AC1 строка за окном (6 дней назад) — 403 past_day_locked", res.status() === 403 && body.code === "past_day_locked", `${res.status()} ${body.code ?? ""}`);
  res = await owner.api.delete(url, { data: { employeeId: ADMIN.id, date: "не дата" } });
  check("AC1 неверная дата — 400", res.status() === 400, String(res.status()));
  const ownerRows = async () => Number((await q(`select count(*)::int c from "JournalDocumentEntry" where "documentId"=$1 and "employeeId"=$2`, [doc.id, ADMIN.id]))[0].c);
  const rowsBefore = await ownerRows();
  res = await owner.api.delete(url, { data: { ids: [5], employeeId: ADMIN.id } });
  check("AC1 испорченный ids с сотрудником — 400, строка сотрудника цела (не «удалить всю строку»)", res.status() === 400 && (await ownerRows()) === rowsBefore, `${res.status()} rows ${rowsBefore}→${await ownerRows()}`);
  await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [point.id]);
  await q(`update "JournalDocument" set "autoFill"=false where id=$1`, [doc.id]);
  await owner.api.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: OFF } });

  // ---------- AC2: перенос строки из будущего дня ----------
  res = await owner.api.patch(url, { data: { entries: [{ employeeId: ADMIN.id, date: dayKey(2), data: DATA }] } });
  const future = await at(ADMIN.id, dayKey(2));
  check("стенд: у руководителя строка на послезавтра", Boolean(future), `PATCH ${res.status()}`);
  await owner.api.delete(url, { data: { employeeId: ADMIN.id, date: today } });
  res = await owner.api.put(url, { data: { entryId: future.id, employeeId: ADMIN.id, date: today, data: DATA } });
  body = await res.json().catch(() => ({}));
  const movedTo = (await q(`select to_char(date,'YYYY-MM-DD') d from "JournalDocumentEntry" where id=$1`, [future.id]))[0]?.d;
  check("AC2 руководитель переносит строку с послезавтра на сегодня — 200 (было 403 future_day_locked)", res.status() === 200 && movedTo === today, `${res.status()} ${body.code ?? ""} → ${movedTo}`);
  res = await owner.api.put(url, { data: { employeeId: ADMIN.id, date: dayKey(3), data: DATA } });
  body = await res.json().catch(() => ({}));
  check("AC2 запись В будущий день — по-прежнему 403", res.status() === 403 && body.code === "future_day_locked", `${res.status()} ${body.code ?? ""}`);
  const cookFuture = await at(COOK.id, dayKey(2));
  await owner.api.delete(url, { data: { employeeId: COOK.id, date: today } });
  res = await cook.api.put(url, { data: { entryId: cookFuture?.id, employeeId: COOK.id, date: today, data: DATA } });
  body = await res.json().catch(() => ({}));
  check("AC2 сотрудник свою строку с будущего дня не переносит — 403", Boolean(cookFuture) && res.status() === 403 && body.code === "not_today", `${res.status()} ${body.code ?? ""}`);

  // ---------- AC7: коды ошибок API ППК ----------
  const compare = (query) => owner.api.get(`${BASE}/api/production-control/revisions/compare?${query}`);
  res = await compare("docKey=");
  body = await res.json().catch(() => ({}));
  check("AC7 сравнение: пустой ключ — 400 bad_request", res.status() === 400 && body.code === "bad_request", `${res.status()} ${body.code}`);
  res = await compare("docKey=garbage");
  body = await res.json().catch(() => ({}));
  check("AC7 сравнение: битый ключ — 404 doc_not_found", res.status() === 404 && body.code === "doc_not_found", `${res.status()} ${body.code}`);
  res = await compare(`docKey=${encodeURIComponent(`text:text-terms@${point.id}`)}`);
  body = await res.json().catch(() => ({}));
  check("AC7 сравнение: у документа нет редакций — 404 no_revisions", res.status() === 404 && body.code === "no_revisions", `${res.status()} ${body.code}`);
  const approve = (data) => owner.api.post(`${BASE}/api/production-control/revisions`, { data });
  res = await approve({});
  body = await res.json().catch(() => ({}));
  check("AC7 утверждение: без ключа — 400 bad_request", res.status() === 400 && body.code === "bad_request", `${res.status()} ${body.code}`);
  res = await approve({ docKey: "garbage" });
  body = await res.json().catch(() => ({}));
  check("AC7 утверждение: документа нет — 404 doc_not_found", res.status() === 404 && body.code === "doc_not_found", `${res.status()} ${body.code}`);
  const draft = (data) => owner.api.post(`${BASE}/api/production-control/text-docs/draft`, { data });
  res = await draft({});
  body = await res.json().catch(() => ({}));
  check("AC7 черновик: неверный запрос — 400 bad_request", res.status() === 400 && body.code === "bad_request", `${res.status()} ${body.code}`);
  res = await draft({ block: "text-terms" });
  body = await res.json().catch(() => ({}));
  check("AC7 черновик: ИИ-помощник не подключён на стенде — 503 ai_not_configured", res.status() === 503 && body.code === "ai_not_configured", `${res.status()} ${body.code}`);
  const cookCompare = await cook.api.get(`${BASE}/api/production-control/revisions/compare?docKey=garbage`);
  body = await cookCompare.json().catch(() => ({}));
  check("AC7 доступ ППК: сотруднику — 403 forbidden", cookCompare.status() === 403 && body.code === "forbidden", `${cookCompare.status()} ${body.code}`);

  // ---------- AC7: интерфейс на английском показывает перевод по коду ----------
  // Язык кабинета — из профиля пользователя (кука языка — только для гостей): на время проверки — английский.
  await q(`update "User" set locale='en' where id=$1`, [ADMIN.id]);
  try {
    const en = await login("admin@haccp.local", "admin1234", "en");
    await en.api.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });
    await en.page.goto(`${BASE}/production-control/item/1-9`, { waitUntil: "networkidle", timeout: 180000 });
    const button = en.page.locator("[data-ppk-draft]").first();
    await button.waitFor({ timeout: 120000 });
    await button.click();
    // В поле уже есть текст — сначала «Заменить?».
    const replace = en.page.getByRole("button", { name: /^Replace$/ });
    if (await replace.isVisible({ timeout: 5000 }).catch(() => false)) await replace.click();
    const toast = en.page.locator("[data-sonner-toast]").filter({ hasText: /AI assistant/ }).first();
    await toast.waitFor({ timeout: 60000 }).catch(() => {});
    const text = (await toast.innerText().catch(() => "")).trim();
    check("AC7 интерфейс en: ошибка черновика по-английски", text.includes("The AI assistant is not connected"), text.slice(0, 120));
    await en.page.screenshot({ path: `${OUT}/ac7-en-draft-toast.png` });
    await en.ctx.close();
  } finally {
    await q(`update "User" set locale=$2 where id=$1`, [ADMIN.id, ADMIN.locale]);
  }
} finally {
  if (point) await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [point.id]).catch(() => {});
  // Утверждение на стенде не должно оставлять редакций.
  if (point) await q(`delete from "PpkRevision" where "organizationId"=$1 and "docKey" like $2`, [ADMIN.organizationId, `%@${point.id}`]).catch(() => {});
  if (doc) await q(`update "JournalDocument" set "autoFill"=false where id=$1`, [doc.id]).catch(() => {});
  // Точки сценария (и прошлых прогонов) — удалить: стенд остаётся как был.
  const leftovers = await q(`select id from "Building" where "organizationId"=$1 and name like 'Кафе мелочи %'`, [ADMIN.organizationId]).catch(() => []);
  for (const row of leftovers) await owner.api.delete(`${BASE}/api/settings/buildings/${row.id}`).catch(() => {});
  const left = await q(`select count(*)::int c from "Building" where "organizationId"=$1 and name like 'Кафе мелочи %'`, [ADMIN.organizationId]);
  check("стенд: точки сценария удалены", left[0].c === 0, `осталось ${left[0].c}`);
  if (rawSetting === null) await q(`delete from "PlatformSetting" where key=$1`, [KEY]);
  else await q(`update "PlatformSetting" set value=$2 where key=$1`, [KEY, rawSetting]);
  const restored = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
  check("стенд: спецрежим возвращён как был", JSON.stringify(restored) === JSON.stringify(rawSetting));
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  await browser.close();
  await pg.end();
  process.exitCode = failed ? 1 : 0;
}
