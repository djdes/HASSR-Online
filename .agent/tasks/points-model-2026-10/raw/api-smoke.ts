/**
 * API-смоук AC3/AC4/AC6/AC7/AC8 на копии демо-базы (wesetup_points) через
 * живой dev-сервер. Перед запуском: seed-legacy-fixture.cjs и
 * backfill-area-building.ts --apply.
 *
 *   npx tsx .agent/tasks/points-model-2026-10/raw/api-smoke.ts http://localhost:3042
 *
 * Пишет строки PASS/FAIL в stdout; итог — последней строкой.
 */
import "dotenv/config";
import pg from "pg";

import { mintEquipmentQrToken } from "@/lib/equipment-qr-token";

const BASE = process.argv[2] ?? "http://localhost:3042";
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_points";
if (!/localhost:5432\/wesetup_points/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("DATABASE_URL must point at the local wesetup_points copy");
}
const ORG = "cmvbfyemt0000uw9mywdjiurr";
const B1 = "fx-building-lenina";
const B2 = "fx-building-mira";
const FOREIGN_BUILDING = "fx-building-single";
const FOREIGN_AREA = "fx-a-single-kitchen";
const FOREIGN_ROOM = "fx-r-single-kitchen";

const sql = new pg.Client({ connectionString: DB });
const results: string[] = [];
let failed = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) failed += 1;
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`;
  results.push(line);
  console.log(line);
}

// ---------- HTTP с куками
const jar = new Map<string, string>();
function storeCookies(res: Response) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1));
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
async function http(method: string, path: string, body?: unknown, extraCookies = "") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      cookie: [cookieHeader(), extraCookies].filter(Boolean).join("; "),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  storeCookies(res);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 200);
  }
  return { status: res.status, json: json as Record<string, any>, text };
}

async function login() {
  const csrf = await http("GET", "/api/auth/csrf");
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({
      csrfToken: csrf.json.csrfToken,
      email: "admin@haccp.local",
      password: "admin1234",
      json: "true",
      callbackUrl: `${BASE}/dashboard`,
    }),
  });
  storeCookies(res);
  const session = await http("GET", "/api/auth/session");
  if (!session.json?.user) throw new Error(`login failed: ${session.text.slice(0, 200)}`);
}

const one = async <T = any>(text: string, params: unknown[] = []) => (await sql.query(text, params)).rows[0] as T;
const all = async <T = any>(text: string, params: unknown[] = []) => (await sql.query(text, params)).rows as T[];
const areasNamed = (name: string) =>
  all<{ id: string; buildingId: string | null }>(
    `SELECT id, "buildingId" FROM "Area" WHERE "organizationId" = $1 AND lower(name) = lower($2) ORDER BY "buildingId" NULLS LAST`,
    [ORG, name],
  );
const fryerDocs = () =>
  all<{ id: string; buildingId: string | null; config: any }>(
    `SELECT d.id, d."buildingId", d.config FROM "JournalDocument" d JOIN "JournalTemplate" t ON t.id = d."templateId"
      WHERE d."organizationId" = $1 AND t.code = 'fryer_oil' AND d.status = 'active' ORDER BY d."buildingId" NULLS FIRST`,
    [ORG],
  );

async function main() {
  await sql.connect();
  await login();
  check("login admin@haccp.local", true);

  // ---------- AC3 + AC4: зеркало помещения ↔ цех с точкой
  const r1 = await http("POST", "/api/settings/rooms", { buildingId: B2, name: "Холодильный цех", kind: "production" });
  const cold = await areasNamed("Холодильный цех");
  check(
    "AC3/AC4 POST rooms: kind=production принят; цех без точки с тем же названием получил точку помещения",
    r1.status === 200 && r1.json.room?.kind === "production" && cold.length === 1 && cold[0].buildingId === B2,
    { status: r1.status, areas: cold },
  );

  const r2 = await http("POST", "/api/settings/rooms", { buildingId: B1, name: "Кондитерский цех", kind: "kitchen" });
  const pastry = await areasNamed("Кондитерский цех");
  check(
    "AC3 POST rooms: одноимённое помещение другой точки — свой цех (два цеха, разные точки)",
    r2.status === 200 && pastry.length === 2 && new Set(pastry.map((a) => a.buildingId)).size === 2 &&
      pastry.some((a) => a.buildingId === B1) && pastry.some((a) => a.buildingId === B2),
    pastry,
  );
  const newRoomId = r2.json.room?.id as string;

  const r3 = await http("PATCH", `/api/settings/rooms/${newRoomId}`, { name: "Кондитерская Ленина" });
  const renamed = await areasNamed("Кондитерская Ленина");
  const pastryAfter = await areasNamed("Кондитерский цех");
  check(
    "AC3 PATCH rooms: переименован цех этой точки, одноимённый цех другой точки не тронут",
    r3.status === 200 && renamed.length === 1 && renamed[0].buildingId === B1 &&
      pastryAfter.length === 1 && pastryAfter[0].buildingId === B2,
    { renamed, pastryAfter },
  );

  const r4 = await http("DELETE", `/api/settings/rooms/${newRoomId}`);
  const deleted = await areasNamed("Кондитерская Ленина");
  const pastryKept = await areasNamed("Кондитерский цех");
  check(
    "AC3 DELETE rooms: удалён только зеркальный цех этой точки",
    r4.status === 200 && deleted.length === 0 && pastryKept.length === 1 && pastryKept[0].buildingId === B2,
    { deleted, pastryKept },
  );

  // «Мойка» неоднозначна (помещения в двух точках, цех без точки):
  // переименование помещения точки 1 берёт цех без точки и ставит ему точку 1.
  const wash1 = await one<{ id: string }>(`SELECT id FROM "Room" WHERE id = 'fx-r-wash1'`);
  const r5 = await http("PATCH", `/api/settings/rooms/${wash1.id}`, { name: "Мойка кухонная" });
  const washRenamed = await areasNamed("Мойка кухонная");
  check(
    "AC3 PATCH rooms: цех без точки переименован и получил точку помещения",
    r5.status === 200 && washRenamed.length === 1 && washRenamed[0].buildingId === B1,
    washRenamed,
  );

  const a1 = await http("POST", "/api/areas", { name: "Цех чужой точки", buildingId: FOREIGN_BUILDING });
  check("AC3 POST /api/areas: чужая точка → 400", a1.status === 400, { status: a1.status, error: a1.json?.error });

  const a2 = await http("POST", "/api/areas", { name: "Овощной цех", buildingId: B2 });
  const vegRoom = await one<{ n: string }>(`SELECT count(*) n FROM "Room" WHERE "buildingId" = $1 AND name = 'Овощной цех'`, [B2]);
  check(
    "AC3 POST /api/areas: buildingId своей точки сохранён, помещение появилось в этой точке",
    (a2.status === 200 || a2.status === 201) && a2.json?.area?.buildingId === B2 && vegRoom.n === "1",
    { status: a2.status, buildingId: a2.json?.area?.buildingId, rooms: vegRoom.n },
  );
  const vegId = a2.json?.area?.id as string;

  const a3 = await http("PUT", `/api/areas/${vegId}`, { name: "Овощной цех", buildingId: null });
  const a4 = await http("PUT", `/api/areas/${vegId}`, { name: "Овощной цех", buildingId: FOREIGN_BUILDING });
  const vegNow = await one<{ buildingId: string | null }>(`SELECT "buildingId" FROM "Area" WHERE id = $1`, [vegId]);
  check(
    "AC3 PUT /api/areas/[id]: null — «без точки»; чужая точка → 400 и ничего не меняет",
    a3.status === 200 && a4.status === 400 && vegNow.buildingId === null,
    { put: a3.status, foreign: a4.status, now: vegNow.buildingId },
  );
  const a5 = await http("PUT", `/api/areas/${vegId}`, { name: "Овощной цех" });
  const vegKept = await one<{ buildingId: string | null }>(`SELECT "buildingId" FROM "Area" WHERE id = $1`, [vegId]);
  check("AC3 PUT /api/areas/[id]: точка не передана — не меняется", a5.status === 200 && vegKept.buildingId === null, vegKept);

  const a6 = await http("POST", "/api/areas", { name: "Цех без выбора точки" });
  check(
    "AC3 POST /api/areas без buildingId при двух точках — без точки (не угадываем)",
    (a6.status === 200 || a6.status === 201) && a6.json?.area?.buildingId === null,
    { status: a6.status, buildingId: a6.json?.area?.buildingId },
  );

  // ---------- AC6: оборудование → помещение точки
  const e1 = await http("POST", "/api/equipment", {
    name: "Холодильник производства",
    type: "refrigerator",
    roomId: "fx-r-prod",
    tempMin: 2,
    tempMax: 6,
  });
  const prodAreas = await areasNamed("Основное производство");
  const e1Area = e1.json?.equipment?.areaId as string | undefined;
  check(
    "AC6 POST /api/equipment с roomId помещения без цеха: цех создан с точкой помещения",
    e1.status === 201 && prodAreas.length === 1 && prodAreas[0].buildingId === B2 && e1Area === prodAreas[0].id,
    { status: e1.status, prodAreas, e1Area },
  );
  const e1Id = e1.json?.equipment?.id as string;

  const e2 = await http("POST", "/api/equipment", { name: "Чужой", type: "other", areaId: FOREIGN_AREA });
  const e3 = await http("POST", "/api/equipment", { name: "Чужой 2", type: "other", roomId: FOREIGN_ROOM });
  const e4 = await http("PUT", `/api/equipment/${e1Id}`, { name: "Холодильник производства", areaId: FOREIGN_AREA });
  const e5 = await http("PUT", `/api/equipment/${e1Id}`, { name: "Холодильник производства", roomId: FOREIGN_ROOM });
  const e1Still = await one<{ areaId: string }>(`SELECT "areaId" FROM "Equipment" WHERE id = $1`, [e1Id]);
  check(
    "AC6 чужие areaId/roomId → 4xx (POST и PUT), оборудование не переехало",
    [e2.status, e3.status, e4.status, e5.status].every((s) => s >= 400 && s < 500) && e1Still.areaId === e1Area,
    { post: [e2.status, e3.status], put: [e4.status, e5.status] },
  );

  // ---------- AC7: фритюрница справочника ↔ журнал фритюра
  // Документ точки 1 — создаём через API с выбранной в шапке точкой.
  const docB1 = await http(
    "POST",
    "/api/journal-documents",
    { templateCode: "fryer_oil", dateFrom: "2026-10-01", dateTo: "2026-10-31", force: true },
    `wesetup.building=${ORG}:${B1}`,
  );
  const docsAfterCreate = await fryerDocs();
  const b1Doc = docsAfterCreate.find((doc) => doc.buildingId === B1);
  const general = docsAfterCreate.find((doc) => doc.buildingId === null);
  const fryer8 = await one<{ id: string }>(`SELECT id FROM "Equipment" WHERE name = 'Фритюрница 8л'`);
  check(
    "AC7 создание документа точки: фритюрница этой точки сразу в списке, образцы «Фритюрница №1–3» убраны",
    docB1.status === 201 && Boolean(b1Doc) &&
      b1Doc!.config.equipmentLinks?.some((l: any) => l.sourceEquipmentId === fryer8.id) &&
      !b1Doc!.config.lists.equipmentTypes.some((n: string) => /Фритюрница №/.test(n)),
    { status: docB1.status, b1: b1Doc?.config?.lists?.equipmentTypes, links: b1Doc?.config?.equipmentLinks },
  );

  const pastryArea = (await areasNamed("Кондитерский цех"))[0];
  const f1 = await http("POST", "/api/equipment", { name: "Фритюрница Мира", type: "fryer", areaId: pastryArea.id });
  const fryerMiraId = f1.json?.equipment?.id as string;
  let docs = await fryerDocs();
  const b1AfterMira = docs.find((doc) => doc.buildingId === B1)!;
  const generalAfterMira = docs.find((doc) => doc.buildingId === null)!;
  check(
    "AC7 создание фритюрницы: попала в общий документ, НЕ попала в документ другой точки",
    f1.status === 201 &&
      generalAfterMira.config.equipmentLinks.some((l: any) => l.sourceEquipmentId === fryerMiraId) &&
      generalAfterMira.config.lists.equipmentTypes.includes("Фритюрница Мира") &&
      !b1AfterMira.config.equipmentLinks.some((l: any) => l.sourceEquipmentId === fryerMiraId) &&
      !b1AfterMira.config.lists.equipmentTypes.includes("Фритюрница Мира"),
    { general: generalAfterMira.config.lists.equipmentTypes, b1: b1AfterMira.config.lists.equipmentTypes },
  );

  const f2 = await http("PUT", `/api/equipment/${fryerMiraId}`, { name: "Фритюрница Мира большая", type: "fryer" });
  docs = await fryerDocs();
  const generalRenamed = docs.find((doc) => doc.buildingId === null)!;
  check(
    "AC7 переименование в справочнике доходит до списка документа",
    f2.status === 200 &&
      generalRenamed.config.lists.equipmentTypes.includes("Фритюрница Мира большая") &&
      !generalRenamed.config.lists.equipmentTypes.includes("Фритюрница Мира") &&
      generalRenamed.config.equipmentLinks.some((l: any) => l.sourceEquipmentId === fryerMiraId && l.name === "Фритюрница Мира большая"),
    generalRenamed.config.lists.equipmentTypes,
  );

  // ---------- AC8: наклейка фритюрницы
  const org = await one<{ qrFillMode: string }>(`SELECT "qrFillMode" FROM "Organization" WHERE id = $1`, [ORG]);
  const employee = await one<{ id: string; name: string }>(
    `SELECT id, name FROM "User" WHERE "organizationId" = $1 AND "isActive" = true AND "qrPinHash" IS NULL
       AND role IN ('operator','cook') AND COALESCE(array_length("buildingIds", 1), 0) = 0 ORDER BY name LIMIT 1`,
    [ORG],
  );
  const token = mintEquipmentQrToken(fryer8.id);
  console.log(`INFO qrFillMode=${org.qrFillMode} employee=${employee?.name} fryerUrl=${BASE}/equipment-fill/${fryer8.id}?token=${encodeURIComponent(token)}`);
  const page = await fetch(`${BASE}/equipment-fill/${fryer8.id}?token=${encodeURIComponent(token)}`);
  const html = await page.text();
  check(
    "AC8 GET /equipment-fill/[id] фритюрницы: форма журнала фритюрных жиров, не форма температуры",
    page.status === 200 && html.includes("Начало жарки") && !html.includes("Температура холодильного оборудования"),
    { status: page.status, len: html.length },
  );

  const endFirst = await http("POST", `/api/equipment-fill/${fryer8.id}/fryer`, {
    token, employeeId: employee.id, phase: "end", quality: 4, carryoverKg: 0, disposedKg: 0,
  });
  check("AC8 окончание без начала → 409 needStart", endFirst.status === 409 && endFirst.json?.errorCode === "equipmentFill.fryer.needStart", endFirst.json);

  const start = await http("POST", `/api/equipment-fill/${fryer8.id}/fryer`, {
    token, employeeId: employee.id, phase: "start", fatType: "Подсолнечное масло", productType: "Картофель фри", quality: 5,
  });
  const entryAfterStart = await one<{ id: string; documentId: string; data: any }>(
    `SELECT id, "documentId", data FROM "JournalDocumentEntry" WHERE data->>'sourceEquipmentId' = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [fryer8.id],
  );
  check(
    "AC8 первый скан — начало жарки: строка в документе точки фритюрницы со ссылкой на неё",
    start.status === 200 && entryAfterStart?.documentId === b1Doc?.id && entryAfterStart.data.fatType === "Подсолнечное масло" &&
      entryAfterStart.data.qualityStart === 5 && entryAfterStart.data.equipmentType === "Фритюрница 8л",
    { status: start.status, body: start.json, entry: entryAfterStart && { doc: entryAfterStart.documentId, data: entryAfterStart.data } },
  );

  const end = await http("POST", `/api/equipment-fill/${fryer8.id}/fryer`, {
    token, employeeId: employee.id, phase: "end", quality: 3, carryoverKg: 1.5, disposedKg: 2,
  });
  const entryAfterEnd = await one<{ id: string; data: any }>(`SELECT id, data FROM "JournalDocumentEntry" WHERE id = $1`, [entryAfterStart?.id]);
  const sameDay = await one<{ n: string }>(
    `SELECT count(*) n FROM "JournalDocumentEntry" WHERE data->>'sourceEquipmentId' = $1`,
    [fryer8.id],
  );
  check(
    "AC8 второй скан — окончание жарки в ту же строку дня",
    end.status === 200 && entryAfterEnd.data.qualityEnd === 3 && entryAfterEnd.data.carryoverKg === 1.5 &&
      entryAfterEnd.data.endHour !== null && sameDay.n === "1",
    { status: end.status, rows: sameDay.n, end: entryAfterEnd?.data && { qualityEnd: entryAfterEnd.data.qualityEnd, endHour: entryAfterEnd.data.endHour } },
  );

  const badToken = await http("POST", `/api/equipment-fill/${fryer8.id}/fryer`, {
    token: mintEquipmentQrToken(fryerMiraId), employeeId: employee.id, phase: "start", fatType: "x", productType: "y", quality: 5,
  });
  check("AC8 наклейка другой фритюрницы → 401", badToken.status === 401, badToken.status);

  // Нет активного документа → 409 и плашка на странице. Временно закрываем
  // активные документы фритюра и возвращаем как было.
  const activeIds = (await fryerDocs()).map((doc) => doc.id);
  await sql.query(`UPDATE "JournalDocument" SET status = 'closed' WHERE id = ANY($1)`, [activeIds]);
  try {
    const noDoc = await http("POST", `/api/equipment-fill/${fryerMiraId}/fryer`, {
      token: mintEquipmentQrToken(fryerMiraId), employeeId: employee.id, phase: "start", fatType: "x", productType: "y", quality: 5,
    });
    const noDocPage = await (await fetch(`${BASE}/equipment-fill/${fryerMiraId}?token=${encodeURIComponent(mintEquipmentQrToken(fryerMiraId))}`)).text();
    const stillNone = (await fryerDocs()).length;
    check(
      "AC8 нет активного документа: 409 no-active-document и плашка на странице",
      noDoc.status === 409 && noDoc.json?.code === "no-active-document" && noDocPage.includes("не входит ни в один активный журнал"),
      { status: noDoc.status, code: noDoc.json?.code, autoCreatedDocs: stillNone },
    );
  } finally {
    await sql.query(`UPDATE "JournalDocument" SET status = 'active' WHERE id = ANY($1)`, [activeIds]);
  }

  // Удаление фритюрницы — связь снята, имя в списке осталось.
  const f3 = await http("DELETE", `/api/equipment/${fryerMiraId}`);
  docs = await fryerDocs();
  const generalAfterDelete = docs.find((doc) => doc.buildingId === null)!;
  check(
    "AC7 удаление фритюрницы: связь снята, имя в списке осталось",
    f3.status === 200 &&
      !generalAfterDelete.config.equipmentLinks.some((l: any) => l.sourceEquipmentId === fryerMiraId) &&
      generalAfterDelete.config.lists.equipmentTypes.includes("Фритюрница Мира большая"),
    generalAfterDelete.config.equipmentLinks,
  );

  console.log(`SUMMARY ${failed === 0 ? "PASS" : "FAIL"} checks=${results.length} failed=${failed}`);
  await sql.end();
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
