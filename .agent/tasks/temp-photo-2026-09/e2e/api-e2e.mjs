// API e2e «Фото к замеру» против dev-сервера с моком диспетчера (temp-photo-2026-09).
// Запуск: SP=<временная папка ВНЕ рабочей копии: fixture.json, vision-mock.json, uploads/> node api-e2e.mjs   (фикстура — setup.ts, мок — WESETUP_VISION_MOCK_FILE=$SP/vision-mock.json)
import { createRequire } from "node:module";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "C:/wt/tphoto";
const require = createRequire(`${ROOT}/package.json`);
const { request } = require("playwright-core");
const pg = require("pg");

const SP = process.env.SP;
const E2E = `${ROOT}/.agent/tasks/temp-photo-2026-09/e2e`;
const EV = `${ROOT}/.agent/tasks/temp-photo-2026-09/evidence`;
const BASE = process.env.BASE ?? "http://localhost:3048";
const fx = JSON.parse(readFileSync(`${SP}/fixture.json`, "utf8"));
const env = Object.fromEntries(
  readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const db = new pg.Client({ connectionString: env.DATABASE_URL });
const FRIDGE_PHOTO = `${EV}/display-fridge-4.5.jpg`;
const HYGRO_PHOTO = `${EV}/display-hygro-21.5.jpg`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
function setMock(variant) {
  copyFileSync(`${E2E}/vision-mock-${variant}.json`, `${SP}/vision-mock.json`);
}
async function setPlan(plan) {
  await db.query(`UPDATE "Account" SET "subscriptionPlan"=$1 WHERE id=(SELECT "accountId" FROM "Organization" WHERE id=$2)`, [plan, fx.organizationId]);
  await db.query(`UPDATE "Organization" SET "subscriptionPlan"=$1 WHERE id=$2`, [plan, fx.organizationId]);
}
let ipSeq = 10;
function ip() {
  ipSeq += 1;
  return { "x-forwarded-for": `10.9.0.${ipSeq}` };
}
function photoPart(file, mimeType = "image/jpeg") {
  return { name: path.basename(file), mimeType, buffer: readFileSync(file) };
}
async function upload(api, { kind = "equipment", employeeId = fx.cookId, file = FRIDGE_PHOTO, token, objectId, mimeType } = {}) {
  const res = await api.post(`${BASE}/api/qr-fill/reading-photo`, {
    headers: ip(),
    multipart: {
      kind,
      objectId: objectId ?? (kind === "equipment" ? fx.equipmentId : fx.roomId),
      token: token ?? (kind === "equipment" ? fx.equipmentToken : fx.roomToken),
      employeeId,
      photo: photoPart(file, mimeType),
    },
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function recognize(api, { kind = "equipment", employeeId = fx.cookId, url, metric = "temperature" } = {}) {
  const res = await api.post(`${BASE}/api/qr-fill/reading-photo/recognize`, {
    headers: ip(),
    data: {
      kind,
      objectId: kind === "equipment" ? fx.equipmentId : fx.roomId,
      token: kind === "equipment" ? fx.equipmentToken : fx.roomToken,
      employeeId,
      url,
      metric,
    },
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
function uploadPath(url) {
  return path.join(SP, "uploads", ...url.replace(/^\/uploads\//, "").split("/"));
}
async function todayEntry(documentId, employeeId) {
  const { rows } = await db.query(
    `SELECT data FROM "JournalDocumentEntry" WHERE "documentId"=$1 AND "employeeId"=$2 ORDER BY date DESC LIMIT 1`,
    [documentId, employeeId]
  );
  return rows[0]?.data ?? null;
}
async function login(email) {
  const api = await request.newContext({ timeout: 240_000 });
  const csrf = await (await api.get(`${BASE}/api/auth/csrf`)).json();
  await api.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, email, password: fx.password, json: "true" } });
  const session = await (await api.get(`${BASE}/api/auth/session`)).json();
  return { api, session };
}

async function main() {
  await db.connect();
  const qr = await request.newContext({ timeout: 240_000 });
  await setPlan("free");
  setMock("readable");

  // ── Бесплатный тариф ──
  const free = await upload(qr);
  check("free: фото с наклейки прикрепляется (200, ссылка /uploads/readings/…)", free.status === 200 && /^\/uploads\/readings\/[a-f0-9]{32}\.jpg$/.test(free.body?.url ?? ""), JSON.stringify(free.body));
  check("free: автоввода нет (autofill=false), сотруднику — без ссылки на тарифы", free.body?.autofill === false && free.body?.tariffsHref === null);
  check("free: файл снимка лежит в каталоге загрузок", free.body?.url && existsSync(uploadPath(free.body.url)));
  const freeManager = await upload(qr, { employeeId: fx.managerId });
  check("free: руководителю — ссылка на тарифы", freeManager.body?.tariffsHref === "/settings/subscription", JSON.stringify(freeManager.body));
  const refused = await recognize(qr, { url: free.body?.url });
  check(
    "free: сервер отказывает в распознавании — 402 «Автоввод с фото — на платном тарифе»",
    refused.status === 402 && refused.body?.code === "paid_only" && refused.body?.error === "Автоввод с фото — на платном тарифе",
    `${refused.status} ${JSON.stringify(refused.body)}`
  );

  const saveFree = await qr.post(`${BASE}/api/equipment-fill/${fx.equipmentId}`, {
    headers: ip(),
    data: { token: fx.equipmentToken, employeeId: fx.cookId, temperature: 4.5, photo: free.body?.url },
  });
  const saveFreeBody = await saveFree.json().catch(() => null);
  check("free: замер с фото сохранён (photoAttached)", saveFree.status() === 200 && saveFreeBody?.photoAttached === true, JSON.stringify(saveFreeBody));
  const coldData = await todayEntry(fx.coldDocumentId, fx.cookId);
  const slotKeys = Object.keys(coldData?.temperatures ?? {});
  check(
    "free: в записи журнала холодильников фото рядом со значением (readingPhotos[ключ замера])",
    slotKeys.length === 1 && coldData.temperatures[slotKeys[0]] === 4.5 && coldData.readingPhotos?.[slotKeys[0]] === free.body?.url,
    JSON.stringify(coldData)
  );

  const saveNoPhoto = await qr.post(`${BASE}/api/equipment-fill/${fx.equipmentId}`, {
    headers: ip(),
    data: { token: fx.equipmentToken, employeeId: fx.cookId, temperature: 5 },
  });
  const afterNoPhoto = await todayEntry(fx.coldDocumentId, fx.cookId);
  check(
    "повторный замер без фото прежний снимок не стирает",
    saveNoPhoto.status() === 200 && afterNoPhoto?.temperatures?.[slotKeys[0]] === 5 && afterNoPhoto?.readingPhotos?.[slotKeys[0]] === free.body?.url,
    JSON.stringify(afterNoPhoto)
  );
  // Вернём 4.5 с тем же фото — для скриншотов документа.
  await qr.post(`${BASE}/api/equipment-fill/${fx.equipmentId}`, {
    headers: ip(),
    data: { token: fx.equipmentToken, employeeId: fx.cookId, temperature: 4.5, photo: free.body?.url },
  });

  for (const [label, photo] of [
    ["чужой адрес", "https://evil.example/a.jpg"],
    ["javascript:", "javascript:alert(1)"],
    ["несуществующий снимок", `/uploads/readings/${"f0".repeat(16)}.jpg`],
  ]) {
    const res = await qr.post(`${BASE}/api/equipment-fill/${fx.equipmentId}`, {
      headers: ip(),
      data: { token: fx.equipmentToken, employeeId: fx.cookId, temperature: 4.5, photo },
    });
    check(`сохранение с фото «${label}» — 400, в журнал не попадает`, res.status() === 400, (await res.json().catch(() => null))?.error);
  }

  const badToken = await upload(qr, { token: "x".repeat(40) });
  check("загрузка с чужим токеном наклейки — 401", badToken.status === 401, JSON.stringify(badToken.body));
  const notImage = await upload(qr, { file: `${E2E}/setup.ts`, mimeType: "image/jpeg" });
  check("не картинка под видом JPEG — 415", notImage.status === 415, JSON.stringify(notImage.body));
  const noPhoto = await qr.post(`${BASE}/api/qr-fill/reading-photo`, {
    headers: ip(),
    multipart: { kind: "equipment", objectId: fx.equipmentId, token: fx.equipmentToken, employeeId: fx.cookId },
  });
  check("без фото — 400", noPhoto.status() === 400);
  const stranger = await upload(qr, { employeeId: "nobody" });
  check("сотрудник не из организации — 404", stranger.status === 404, JSON.stringify(stranger.body));

  // Склад: фото к температуре.
  const roomUp = await upload(qr, { kind: "room", file: HYGRO_PHOTO });
  const saveRoom = await qr.post(`${BASE}/api/room-fill/${fx.roomId}`, {
    headers: ip(),
    data: { token: fx.roomToken, employeeId: fx.cookId, temperature: 21.5, humidity: 48, photo: roomUp.body?.url },
  });
  const saveRoomBody = await saveRoom.json().catch(() => null);
  const climate = await todayEntry(fx.climateDocumentId, fx.cookId);
  const photoKey = Object.keys(climate?.readingPhotos ?? {})[0] ?? "";
  check(
    "склад: фото к температуре в бланке климата (ключ строка:срок:temperature)",
    saveRoom.status() === 200 && saveRoomBody?.photoAttached === true && /^room-.+:\d\d:\d\d:temperature$/.test(photoKey) && climate.readingPhotos[photoKey] === roomUp.body?.url,
    JSON.stringify({ status: saveRoom.status(), photoKey, slot: saveRoomBody?.slot })
  );

  // Сайт: бесплатный тариф.
  const manager = await login(fx.managerEmail);
  check("вход руководителя в кабинет", Boolean(manager.session?.user?.id), manager.session?.user?.email);
  const statusFree = await (await manager.api.get(`${BASE}/api/ocr/reading`)).json();
  check("сайт free: GET /api/ocr/reading → autofill=false, руководителю ссылка на тарифы", statusFree.autofill === false && statusFree.tariffsHref === "/settings/subscription", JSON.stringify(statusFree));
  const siteFree = await manager.api.post(`${BASE}/api/ocr/reading`, { multipart: { photo: photoPart(FRIDGE_PHOTO), metric: "temperature" } });
  const siteFreeBody = await siteFree.json().catch(() => null);
  check("сайт free: POST /api/ocr/reading — 402 paid_only", siteFree.status() === 402 && siteFreeBody?.code === "paid_only", JSON.stringify(siteFreeBody));
  const cookSite = await login(fx.cookEmail);
  const statusCook = await (await cookSite.api.get(`${BASE}/api/ocr/reading`)).json();
  check("сайт free: сотруднику — без ссылки на тарифы", statusCook.autofill === false && statusCook.tariffsHref === null, JSON.stringify(statusCook));

  // ── Платный тариф ──
  await setPlan("paid");
  const paid = await upload(qr);
  check("paid: фото прикрепляется, autofill=true", paid.status === 200 && paid.body?.autofill === true && paid.body?.tariffsHref === null, JSON.stringify(paid.body));
  const before = Date.now();
  const readable = await recognize(qr, { url: paid.body?.url });
  check("paid: показание распознано — 4.5 °C", readable.status === 200 && readable.body?.value === 4.5 && readable.body?.unit === "C", `${readable.status} ${JSON.stringify(readable.body)} ${Date.now() - before}ms`);
  const { rows: usage } = await db.query(
    `SELECT "entityId", details FROM "AuditLog" WHERE "organizationId"=$1 AND action='ai.vision_extract' ORDER BY "createdAt" DESC LIMIT 1`,
    [fx.organizationId]
  );
  check(
    "paid: распознавание в общем учёте «С фото» (ai.vision_extract, visionKind reading, на сотрудника)",
    usage[0]?.entityId === fx.cookId && usage[0]?.details?.visionKind === "reading" && usage[0]?.details?.result === "ok",
    JSON.stringify(usage[0])
  );
  setMock("unreadable");
  const unreadable = await recognize(qr, { url: paid.body?.url });
  check("paid: нечитаемый снимок — value null (ничего не выдумано)", unreadable.status === 200 && unreadable.body?.value === null, JSON.stringify(unreadable.body));
  setMock("humidity");
  const wrongUnit = await recognize(qr, { url: paid.body?.url });
  check("paid: влажность «48 %» в поле температуры не подставляется — value null", wrongUnit.status === 200 && wrongUnit.body?.value === null, JSON.stringify(wrongUnit.body));
  setMock("room");
  const roomPaid = await upload(qr, { kind: "room", file: HYGRO_PHOTO });
  const roomRecognized = await recognize(qr, { kind: "room", url: roomPaid.body?.url });
  check("paid: склад — температура с термогигрометра 21.5", roomRecognized.status === 200 && roomRecognized.body?.value === 21.5, JSON.stringify(roomRecognized.body));
  const foreignUrl = await recognize(qr, { url: "https://evil.example/a.jpg" });
  check("paid: распознавание чужой ссылки — 400", foreignUrl.status === 400, JSON.stringify(foreignUrl.body));

  setMock("readable");
  const statusPaid = await (await manager.api.get(`${BASE}/api/ocr/reading`)).json();
  check("сайт paid: GET /api/ocr/reading → autofill=true", statusPaid.autofill === true && statusPaid.tariffsHref === null, JSON.stringify(statusPaid));
  const sitePaid = await manager.api.post(`${BASE}/api/ocr/reading`, { multipart: { photo: photoPart(FRIDGE_PHOTO), metric: "temperature" } });
  const sitePaidBody = await sitePaid.json().catch(() => null);
  check("сайт paid: POST /api/ocr/reading — 4.5 (прежний контракт value/unit/confidence)", sitePaid.status() === 200 && sitePaidBody?.value === 4.5 && sitePaidBody?.confidence === "high", JSON.stringify(sitePaidBody));

  // Лимиты общие с «С фото»: 20 распознаваний сотрудника за сутки — 21-е отказ и в QR-форме.
  const { rows: counted } = await db.query(
    `SELECT count(*)::int AS n FROM "AuditLog" WHERE "entity"='ai_vision' AND "entityId"=$1 AND action='ai.vision_extract' AND "createdAt" > now() - interval '24 hours'`,
    [fx.cookId]
  );
  const need = Math.max(0, 20 - counted[0].n);
  const fakeIds = [];
  for (let i = 0; i < need; i += 1) {
    const id = `tphoto-fake-${Date.now()}-${i}`;
    fakeIds.push(id);
    await db.query(
      `INSERT INTO "AuditLog" (id, "organizationId", "userId", action, entity, "entityId", details, "createdAt") VALUES ($1,$2,$3,'ai.vision_extract','ai_vision',$3,'{"visionKind":"menu"}'::jsonb, now())`,
      [id, fx.organizationId, fx.cookId]
    );
  }
  const limited = await recognize(qr, { url: paid.body?.url });
  check("лимиты общие с «С фото»: после 20 распознаваний за сутки — 429 и понятный текст", limited.status === 429 && /не больше 20 в сутки/.test(limited.body?.error ?? ""), `${limited.status} ${limited.body?.error}`);
  if (fakeIds.length) await db.query(`DELETE FROM "AuditLog" WHERE id = ANY($1)`, [fakeIds]);

  await setPlan(process.env.FINAL_PLAN ?? "free");
  await manager.api.dispose();
  await cookSite.api.dispose();
  await qr.dispose();
  await db.end();

  const passed = results.filter((r) => r.ok).length;
  const summary = `${passed}/${results.length} PASS`;
  console.log(summary);
  writeFileSync(
    `${EV}/api-e2e.txt`,
    [`API e2e «Фото к замеру» — ${new Date().toISOString()} — ${summary}`, "", ...results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`)].join("\n") + "\n"
  );
  if (passed !== results.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await db.end().catch(() => {});
});
