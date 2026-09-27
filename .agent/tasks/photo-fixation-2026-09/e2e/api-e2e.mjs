// API e2e «Фотофиксация показаний» (photo-fixation-2026-09) против dev-сервера с моком диспетчера.
// Запуск: SP=<папка вне рабочей копии: fixture.json, vision-mock.json, img/, uploads рядом> node api-e2e.mjs
// Фикстура — setup.ts (платный тариф), мок — WESETUP_VISION_MOCK_FILE=$SP/vision-mock.json.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "C:/wt/photofix";
const require = createRequire(`${ROOT}/package.json`);
const { request } = require("playwright-core");
const pg = require("pg");

const SP = process.env.SP;
const BASE = process.env.BASE ?? "http://localhost:3054";
const fx = JSON.parse(readFileSync(`${SP}/fixture.json`, "utf8"));
const env = Object.fromEntries(
  readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const db = new pg.Client({ connectionString: env.DATABASE_URL });
const LED = `${SP}/img/led-4.2.jpg`;
const SETTING_KEY = `org-reading-photo:${fx.organizationId}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
function setMock(reading) {
  writeFileSync(`${SP}/vision-mock.json`, JSON.stringify({ reading: typeof reading === "string" ? reading : JSON.stringify(reading) }));
}
async function setPlan(plan) {
  await db.query(`UPDATE "Account" SET "subscriptionPlan"=$1 WHERE id=(SELECT "accountId" FROM "Organization" WHERE id=$2)`, [plan, fx.organizationId]);
  await db.query(`UPDATE "Organization" SET "subscriptionPlan"=$1 WHERE id=$2`, [plan, fx.organizationId]);
}
let ipSeq = 20;
function ip() {
  ipSeq += 1;
  return { "x-forwarded-for": `10.8.0.${ipSeq}` };
}
const OBJECTS = {
  fridge: { kind: "equipment", id: () => fx.fridgeId, token: () => fx.fridgeToken },
  freezer: { kind: "equipment", id: () => fx.freezerId, token: () => fx.freezerToken },
  room: { kind: "room", id: () => fx.roomId, token: () => fx.roomToken },
};
async function upload(api, object = "fridge") {
  const o = OBJECTS[object];
  const res = await api.post(`${BASE}/api/qr-fill/reading-photo`, {
    headers: ip(),
    multipart: {
      kind: o.kind,
      objectId: o.id(),
      token: o.token(),
      employeeId: fx.cookId,
      pin: fx.cookPin,
      photo: { name: "reading.jpg", mimeType: "image/jpeg", buffer: readFileSync(LED) },
    },
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function recognize(api, url, object = "fridge") {
  const o = OBJECTS[object];
  const res = await api.post(`${BASE}/api/qr-fill/reading-photo/recognize`, {
    headers: ip(),
    data: { kind: o.kind, objectId: o.id(), token: o.token(), employeeId: fx.cookId, pin: fx.cookPin, url, metric: "temperature" },
    timeout: 120_000,
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function save(api, object, body) {
  const o = OBJECTS[object];
  const route = o.kind === "equipment" ? `/api/equipment-fill/${o.id()}` : `/api/room-fill/${o.id()}`;
  const res = await api.post(`${BASE}${route}`, {
    headers: ip(),
    data: { token: o.token(), employeeId: fx.cookId, pin: fx.cookPin, ...body },
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function patchSettings(api, body) {
  const res = await api.patch(`${BASE}/api/settings/compliance`, { data: body, headers: ip() });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function settingRow() {
  const { rows } = await db.query(`SELECT value FROM "PlatformSetting" WHERE key=$1`, [SETTING_KEY]);
  return rows[0]?.value ?? null;
}
async function entryData(documentId) {
  const { rows } = await db.query(`SELECT data FROM "JournalDocumentEntry" WHERE "documentId"=$1 AND "employeeId"=$2 ORDER BY date DESC LIMIT 1`, [documentId, fx.cookId]);
  return rows[0]?.data ?? null;
}
async function login(email) {
  const api = await request.newContext();
  const csrf = await (await api.get(`${BASE}/api/auth/csrf`, { timeout: 240_000 })).json();
  await api.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password: fx.password, json: "true" },
    timeout: 240_000,
  });
  return api;
}

await db.connect();
await setPlan("paid");
await db.query(`DELETE FROM "PlatformSetting" WHERE key=$1`, [SETTING_KEY]);
await db.query(`DELETE FROM "JournalDocumentEntry" WHERE "documentId" = ANY($1)`, [[fx.coldDocumentId, fx.climateDocumentId]]);
// Суточный лимит распознаваний (20 на сотрудника) считается по журналу действий — повторные прогоны в локальной базе его не тратят.
await db.query(`DELETE FROM "AuditLog" WHERE "organizationId"=$1 AND action='ai.vision_extract'`, [fx.organizationId]);
const qr = await request.newContext();
const manager = await login(fx.managerEmail);
const cook = await login(fx.cookEmail);

// ─── Настройка: права ───────────────────────────────────────────────
{
  const anon = await request.newContext();
  const res = await anon.patch(`${BASE}/api/settings/compliance`, { data: { readingPhotoEnabled: false }, headers: ip() });
  check("настройка: без входа — 401", res.status() === 401, String(res.status()));
  await anon.dispose();
  const byCook = await patchSettings(cook, { readingPhotoEnabled: false });
  check("настройка: сотрудник (повар) — 403", byCook.status === 403, JSON.stringify(byCook.body));
  check("настройка: по умолчанию строки нет (включено, фото не обязательно)", (await settingRow()) === null);
}

// ─── По умолчанию: фото прикладывается, распознавание — на платном ──
setMock({ device: "digital", seen: "цифры 4, точка, 2", value: 4.2, unit: "C", confidence: "high" });
const firstPhoto = await upload(qr, "fridge");
check("по умолчанию: фото принято, автоввод на платном тарифе", firstPhoto.status === 200 && firstPhoto.body?.autofill === true, JSON.stringify(firstPhoto.body));
{
  const r = await recognize(qr, firstPhoto.body?.url);
  check("распознавание: цифровой дисплей → 4.2, device digital", r.status === 200 && r.body?.value === 4.2 && r.body?.device === "digital", JSON.stringify(r.body));
  check("распознавание: «seen» клиенту не отдаётся", r.body && !("seen" in r.body));
  const s = await save(qr, "fridge", { temperature: 4.2, photo: firstPhoto.body?.url });
  check("сохранение с фото: 200, photoAttached", s.status === 200 && s.body?.photoAttached === true, JSON.stringify(s.body));
  const data = await entryData(fx.coldDocumentId);
  check("в журнале: temperatures + readingPhotos[замер] = ссылка", Object.values(data?.readingPhotos ?? {}).includes(firstPhoto.body?.url), JSON.stringify(data));
}

// ─── Аналоговые термометры и сомнение модели (мок ответа) ────────────
{
  setMock({ device: "dial", seen: "стрелка между 10 и 20 синей шкалы (мороз), ближе к 20", value: -18.6, unit: "C", confidence: "high" });
  const up = await upload(qr, "freezer");
  const r = await recognize(qr, up.body?.url, "freezer");
  check("стрелочный: −18.6 → −19 (до градуса), confidence не выше medium", r.body?.value === -19 && r.body?.confidence === "medium" && r.body?.device === "dial", JSON.stringify(r.body));
  setMock({ device: "liquid", seen: "верх столбика между 20 и 30, два деления над 20", value: "22.4", unit: "C", confidence: "medium" });
  const r2 = await recognize(qr, up.body?.url, "freezer");
  check("жидкостный: 22.4 → 22", r2.body?.value === 22 && r2.body?.device === "liquid", JSON.stringify(r2.body));
  setMock({ device: "digital", seen: "минус, 2, 6 (или 3) — -26 или -23, средняя цифра неоднозначна", value: -23, unit: "C", confidence: "medium" });
  const r3 = await recognize(qr, up.body?.url, "freezer");
  check("сомнение в seen («-26 или -23») → value null, не подставляем", r3.status === 200 && r3.body?.value === null, JSON.stringify(r3.body));
  setMock({ device: "digital", seen: "минус, цифры 2, 6, 3", value: -263, unit: "C", confidence: "high" });
  const r4 = await recognize(qr, up.body?.url, "freezer");
  check("пропущенная точка (−263) → вне −60…80 → null", r4.body?.value === null, JSON.stringify(r4.body));
  setMock({ device: "other", seen: "цифры закрыты бликом", value: null, unit: null, confidence: "low" });
  const r5 = await recognize(qr, up.body?.url, "freezer");
  check("нечитаемо → null", r5.body?.value === null, JSON.stringify(r5.body));
}

// ─── Выключено ────────────────────────────────────────────────────────
{
  const off = await patchSettings(manager, { readingPhotoEnabled: false });
  check("руководитель выключил фотофиксацию: 200, readingPhoto {enabled:false, required:false}", off.status === 200 && off.body?.readingPhoto?.enabled === false && off.body?.readingPhoto?.required === false, JSON.stringify(off.body?.readingPhoto));
  check("хранение: строка PlatformSetting своей организации", (await settingRow()) === '{"enabled":false,"required":false}', String(await settingRow()));
  const up = await upload(qr, "fridge");
  check("выключено: загрузка фото → 403 photo_disabled", up.status === 403 && up.body?.code === "photo_disabled", JSON.stringify(up.body));
  const r = await recognize(qr, firstPhoto.body?.url);
  check("выключено: распознавание → 403 photo_disabled", r.status === 403 && r.body?.code === "photo_disabled", JSON.stringify(r.body));
  const s = await save(qr, "room", { temperature: 19, photo: firstPhoto.body?.url });
  const data = await entryData(fx.climateDocumentId);
  check("выключено: замер с присланным фото сохраняется, фото не прикладывается", s.status === 200 && !s.body?.photoAttached && !data?.readingPhotos, JSON.stringify({ s: s.body, photos: data?.readingPhotos ?? null }));
}

// ─── Фото обязательно ────────────────────────────────────────────────
{
  const req = await patchSettings(manager, { readingPhotoRequired: true });
  check("«Фото обязательно» включает и фотофиксацию: {enabled:true, required:true}", req.status === 200 && req.body?.readingPhoto?.enabled === true && req.body?.readingPhoto?.required === true, JSON.stringify(req.body?.readingPhoto));
  const noPhoto = await save(qr, "fridge", { temperature: 4.4 });
  check("обязательно: холодильник без фото → 400 photo-required", noPhoto.status === 400 && noPhoto.body?.code === "photo-required", JSON.stringify(noPhoto.body));
  const service = await save(qr, "fridge", { status: "service" });
  check("обязательно: «Обслуживание» без фото → 200", service.status === 200, JSON.stringify(service.body));
  const up = await upload(qr, "fridge");
  const withPhoto = await save(qr, "fridge", { temperature: 4.4, photo: up.body?.url });
  check("обязательно: с фото → 200, photoAttached", withPhoto.status === 200 && withPhoto.body?.photoAttached === true, JSON.stringify(withPhoto.body));
  const fake = await save(qr, "fridge", { temperature: 4.4, photo: `/uploads/readings/${"f".repeat(32)}.jpg` });
  check("обязательно: несуществующий снимок → 400 «Фото не найдено — снимите ещё раз»", fake.status === 400 && fake.body?.error === "Фото не найдено — снимите ещё раз", JSON.stringify(fake.body));
  const roomNoPhoto = await save(qr, "room", { temperature: 20 });
  check("обязательно: склад, температура без фото → 400", roomNoPhoto.status === 400 && roomNoPhoto.body?.code === "photo-required", JSON.stringify(roomNoPhoto.body));
  const roomHumidity = await save(qr, "room", { humidity: 55 });
  check("обязательно: склад, одна влажность → 200 (фото — к температуре)", roomHumidity.status === 200, JSON.stringify(roomHumidity.body));
  const roomUp = await upload(qr, "room");
  const roomWithPhoto = await save(qr, "room", { temperature: 20, photo: roomUp.body?.url });
  check("обязательно: склад с фото → 200, photoAttached", roomWithPhoto.status === 200 && roomWithPhoto.body?.photoAttached === true, JSON.stringify(roomWithPhoto.body));
}

// ─── Назад к умолчанию ───────────────────────────────────────────────
{
  const back = await patchSettings(manager, { readingPhotoEnabled: true, readingPhotoRequired: false });
  check("вернули умолчания: строка удалена", back.status === 200 && (await settingRow()) === null, JSON.stringify(back.body?.readingPhoto));
  const s = await save(qr, "fridge", { temperature: 4.1 });
  check("по умолчанию: без фото — 200, как раньше", s.status === 200, JSON.stringify(s.body));
  const other = await patchSettings(manager, { lockPastDayEdits: false });
  check("соседние настройки «Строгости» сохраняются как раньше и не трогают фотофиксацию", other.status === 200 && other.body?.lockPastDayEdits === false && other.body?.readingPhoto?.enabled === true, JSON.stringify(other.body));
}

// ─── Бесплатный тариф: фото есть, автоввода нет ──────────────────────
{
  await setPlan("free");
  const up = await upload(qr, "fridge");
  check("бесплатный: фото принято, autofill false", up.status === 200 && up.body?.autofill === false, JSON.stringify(up.body));
  const r = await recognize(qr, up.body?.url);
  check("бесплатный: распознавание → 402 paid_only (как было)", r.status === 402 && r.body?.code === "paid_only", JSON.stringify(r.body));
  await setPlan("paid");
}

await qr.dispose();
await manager.dispose();
await cook.dispose();
await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
writeFileSync(`${SP}/api-e2e.json`, JSON.stringify(results, null, 2));
process.exitCode = failed.length ? 1 : 0;
