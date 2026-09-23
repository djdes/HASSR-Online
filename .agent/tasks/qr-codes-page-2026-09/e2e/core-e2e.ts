// E2E ядра страницы QR-кодов (C2–C4): срок дополнительного QR, старый QR
// документа через смену периода, первый документ по основному QR (ровно
// один при 5 параллельных сканах, хаб — ни одного), статус объектного
// журнала без ссылок на заполнение, «кто должен настроить», сверка
// документа в submit, основной QR точки.
// Стенд: npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/core-setup.ts
// Запуск: BASE=http://localhost:3025 npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/core-e2e.ts
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "../../../..");
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });

// Секрет QR-токена — тот же, что у dev-сервера (из .env только секреты подписи, не базу).
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const state = JSON.parse(fs.readFileSync(path.join(HERE, "core-state.json"), "utf8"));
const ORG: string = state.org;
const ORG_LOC: string = state.orgLoc;

const checks: Array<{ id: string; name: string; ok: boolean; detail?: unknown }> = [];
function check(id: string, name: string, ok: boolean, detail?: unknown) {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const { journalFillSubject } = await import("../../../../src/lib/journal-fill");
  const token = (orgId: string, code: string, documentId?: string | null, options?: { validUntil?: string | null; buildingId?: string | null }) =>
    mintQrFillToken("journal", journalFillSubject(orgId, code, documentId, options));
  const pageUrl = (orgId: string, code: string, tok: string, extra = "") => `${BASE}/journal-fill/${orgId}/${code}?token=${encodeURIComponent(tok)}${extra}`;
  const apiUrl = (orgId: string, code: string) => `${BASE}/api/journal-fill/${orgId}/${code}`;
  const get = async (url: string) => {
    const response = await fetch(url, { redirect: "manual" });
    return { status: response.status, html: await response.text() };
  };
  const countDocs = (orgId: string, code: string) => db.journalDocument.count({ where: { organizationId: orgId, template: { code } } });
  const fillLinks = (html: string) => html.match(/href="[^"]*\/journal-fill\/[^"]*"/g) ?? [];

  // ---- C2-1. Просроченный дополнительный QR: 410, без ссылок, ничего не создаёт
  {
    const expired = token(ORG, "fryer_oil", state.docs.expiredDoc, { validUntil: state.yesterday });
    const before = await countDocs(ORG, "fryer_oil");
    const page = await get(pageUrl(ORG, "fryer_oil", expired));
    check("C2-1a", "просроченный QR — экран «срок закончился», 410", page.status === 410 && page.html.includes("Срок этого QR-кода закончился"), { status: page.status });
    check("C2-1b", "на экране нет рабочих ссылок в журнал", fillLinks(page.html).length === 0 && !page.html.includes("token="), fillLinks(page.html));
    const apiGet = await fetch(`${apiUrl(ORG, "fryer_oil")}?token=${encodeURIComponent(expired)}&documentId=${state.docs.expiredDoc}&employeeId=${state.users.cook}`);
    const apiDaily = await fetch(`${apiUrl(ORG, "fryer_oil")}?token=${encodeURIComponent(expired)}&daily=1&employeeId=${state.users.cook}`);
    const apiPost = await fetch(apiUrl(ORG, "fryer_oil"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: expired, documentId: state.docs.expiredDoc, employeeId: state.users.cook, rowKey: `employee-${state.users.cook}`, values: {} }),
    });
    check("C2-1c", "JSON-API и submit отвечают 410", apiGet.status === 410 && apiDaily.status === 410 && apiPost.status === 410, [apiGet.status, apiDaily.status, apiPost.status]);
    const after = await countDocs(ORG, "fryer_oil");
    check("C2-1d", "число документов не меняется", before === after, { before, after });
    // Подмена даты в токене → неверная подпись → «ссылка недействительна».
    const forged = expired.replace(state.yesterday, "2099-12-31");
    const forgedPage = await get(pageUrl(ORG, "fryer_oil", forged));
    check("C2-1e", "подмена даты — «ссылка недействительна»", forged !== expired && forgedPage.html.includes("Ссылка недействительна"), { status: forgedPage.status });
    check("C2-1f", "и после подмены документы не создаются", (await countDocs(ORG, "fryer_oil")) === before);

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const tab = await context.newPage();
    await tab.goto(pageUrl(ORG, "fryer_oil", expired));
    await tab.screenshot({ path: path.join(SHOTS, "core-expired-390.png"), fullPage: true });
    await browser.close();
  }

  // ---- C2-2. Действующий QR со сроком — свой документ
  {
    const pinned = token(ORG, "metal_impurity", state.docs.metalA, { validUntil: state.periods.curMonthTo });
    const page = await get(pageUrl(ORG, "metal_impurity", pinned));
    check("C2-2", "QR со сроком до конца месяца открывает свой документ", page.status === 200 && page.html.includes(`value="${state.docs.metalA}"`) && !page.html.includes(state.docs.metalB), { status: page.status });
  }

  // ---- C2-3. Старый QR документа доходит до документа нового периода
  {
    const legacy = token(ORG, "product_writeoff", state.docs.writeoffPrev);
    const before = await countDocs(ORG, "product_writeoff");
    const page = await get(pageUrl(ORG, "product_writeoff", legacy));
    const fresh = await db.journalDocument.findFirst({
      where: { organizationId: ORG, template: { code: "product_writeoff" }, status: "active", dateFrom: { lte: new Date(`${state.today}T00:00:00.000Z`) }, dateTo: { gte: new Date(`${state.today}T00:00:00.000Z`) } },
      select: { id: true },
    });
    check(
      "C2-3",
      "старый QR документа: создан документ нового периода, форма ведёт в него",
      page.status === 200 && Boolean(fresh) && (await countDocs(ORG, "product_writeoff")) === before + 1 && page.html.includes(`value="${fresh?.id}"`),
      { status: page.status, fresh, snippet: page.html.slice(page.html.indexOf("<main"), page.html.indexOf("<main") + 400) }
    );
  }

  // ---- C4-1. 5 параллельных первых сканов основного QR → ровно 1 документ
  {
    const main = token(ORG, "equipment_cleaning");
    const before = await countDocs(ORG, "equipment_cleaning");
    const pages = await Promise.all(Array.from({ length: 5 }, () => get(pageUrl(ORG, "equipment_cleaning", main))));
    const after = await countDocs(ORG, "equipment_cleaning");
    check("C4-1a", "5 параллельных сканов основного QR — ровно 1 документ", before === 0 && after === 1, { before, after, statuses: pages.map((p) => p.status) });
    check("C4-1b", "все пять сканов получили страницу, не ошибку", pages.every((p) => p.status === 200 && !p.html.includes("нет активного документа")), pages.map((p) => p.status));
    const doc = await db.journalDocument.findFirst({ where: { organizationId: ORG, template: { code: "equipment_cleaning" } }, select: { id: true } });
    const audit = await db.auditLog.count({ where: { organizationId: ORG, action: "journal_document.qr_first_document", entityId: doc?.id } });
    const bell = await db.notification.count({ where: { organizationId: ORG, kind: "journal.qr-first-document" } });
    check("C4-1c", "аудит qr_first_document и уведомление руководству", audit === 1 && bell >= 1, { audit, bell });
  }

  // ---- C4-2. Ручной hub-URL на журнал без документов → 0 документов
  {
    const hub = token(ORG, "all");
    const before = await countDocs(ORG, "glass_control");
    const page = await get(pageUrl(ORG, "glass_control", hub));
    const after = await countDocs(ORG, "glass_control");
    check("C4-2", "hub-токен первый документ не создаёт", before === 0 && after === 0 && page.status === 200, { before, after, status: page.status });
    // QR документа чужого журнала тоже не создаёт: токен другого документа.
    const docToken = token(ORG, "glass_control", state.docs.metalA);
    await get(pageUrl(ORG, "glass_control", docToken));
    check("C4-2b", "токен документа первый документ не создаёт", (await countDocs(ORG, "glass_control")) === 0);
  }

  // ---- C3-1. Основной QR объектного журнала — статус без ссылок на заполнение
  {
    const main = token(ORG, "cold_equipment_control");
    const page = await get(pageUrl(ORG, "cold_equipment_control", main));
    check(
      "C3-1a",
      "холодильники: статус за сегодня и «отсканируйте наклейку»",
      page.status === 200 && page.html.includes("Холодильник №1") && page.html.includes("Отсканируйте наклейку на самом холодильнике"),
      { status: page.status }
    );
    check("C3-1b", "в HTML статуса нет /equipment-fill/ и /room-fill/", !/\/equipment-fill|\/room-fill/.test(page.html));
    const hub = token(ORG, "all");
    const hubPage = await get(pageUrl(ORG, "all", hub));
    check("C3-1c", "УФ-лампы нет в «Все журналы»", hubPage.status === 200 && !hubPage.html.includes("/uv_lamp_runtime?") && !hubPage.html.includes("cold_equipment_control?"), { status: hubPage.status });
    const uv = await get(pageUrl(ORG, "uv_lamp_runtime", hub));
    check(
      "C3-1d",
      "УФ-лампа по ручному hub-URL — только статус, заполнить нельзя",
      uv.status === 200 && uv.html.includes("Облучатель ОБН-150") && !uv.html.includes("<form") && !/\/equipment-fill|\/room-fill/.test(uv.html),
      { status: uv.status }
    );
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const tab = await context.newPage();
    await tab.goto(pageUrl(ORG, "cold_equipment_control", main));
    await tab.screenshot({ path: path.join(SHOTS, "core-object-status-390.png"), fullPage: true });
    await tab.goto(pageUrl(ORG_LOC, "cold_equipment_control", token(ORG_LOC, "cold_equipment_control")));
    await tab.screenshot({ path: path.join(SHOTS, "core-object-empty-390.png"), fullPage: true });
    await browser.close();
  }

  // ---- C3-2. Объектов нет → ответственный и кнопка входа
  {
    const cold = await get(pageUrl(ORG_LOC, "cold_equipment_control", token(ORG_LOC, "cold_equipment_control")));
    check(
      "C3-2a",
      "нет оборудования — «Ответственный за журнал — Нина Точкова, заведующая — должен войти и добавить оборудование»",
      cold.html.includes("Ответственный за журнал — Нина Точкова, заведующая — должен войти и добавить оборудование") &&
        cold.html.includes('href="/login?next=/settings/equipment"'),
      { snippet: cold.html.slice(cold.html.indexOf("<main"), cold.html.indexOf("<main") + 600) }
    );
    const climate = await get(pageUrl(ORG_LOC, "climate_control", token(ORG_LOC, "climate_control")));
    check("C3-2b", "климат без помещений — вход на /settings/buildings", climate.html.includes('href="/login?next=/settings/buildings"') && climate.html.includes("Нина Точкова"));
  }

  // ---- C2-4. Submit не принимает чужой documentId
  {
    const pinned = token(ORG, "metal_impurity", state.docs.metalA, { validUntil: state.periods.curMonthTo });
    const post = (orgId: string, code: string, tok: string, documentId: string) =>
      fetch(apiUrl(orgId, code), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.9.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` },
        body: JSON.stringify({ token: tok, documentId, employeeId: state.users.cook, rowKey: `employee-${state.users.cook}`, values: {} }),
      }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));
    const foreign = await post(ORG, "metal_impurity", pinned, state.docs.metalB);
    const own = await post(ORG, "metal_impurity", pinned, state.docs.metalA);
    check("C2-4a", "QR со сроком: чужой documentId → 403, свой проходит сверку", foreign.status === 403 && own.status !== 403, { foreign, own });
    const apiGet = await fetch(`${apiUrl(ORG, "metal_impurity")}?token=${encodeURIComponent(pinned)}&documentId=${state.docs.metalB}&employeeId=${state.users.cook}`);
    check("C2-4b", "JSON-API GET с чужим documentId → 403", apiGet.status === 403, apiGet.status);
    const legacy = token(ORG_LOC, "metal_impurity", state.docs.locMetalB1);
    const otherPoint = await post(ORG_LOC, "metal_impurity", legacy, state.docs.locMetalB2);
    check("C2-4c", "старый QR документа точки: документ другой точки → 403", otherPoint.status === 403, otherPoint);
    const otherOrg = await post(ORG_LOC, "metal_impurity", legacy, state.docs.metalA);
    check("C2-4d", "документ другой организации → 403", otherOrg.status === 403, otherOrg);
  }

  // ---- C2-5. Основной QR точки `b~`
  {
    const b1Main = token(ORG_LOC, "fryer_oil", null, { buildingId: state.buildings.b1 });
    const before = await countDocs(ORG_LOC, "fryer_oil");
    const page = await get(pageUrl(ORG_LOC, "fryer_oil", b1Main));
    const docs = await db.journalDocument.findMany({ where: { organizationId: ORG_LOC, template: { code: "fryer_oil" } }, select: { buildingId: true } });
    check(
      "C2-5a",
      "основной QR точки создаёт первый документ этой точки",
      before === 0 && docs.length === 1 && docs[0].buildingId === state.buildings.b1 && page.status === 200,
      { before, docs, status: page.status }
    );
    const legacyMain = token(ORG_LOC, "product_writeoff");
    const legacyPage = await get(pageUrl(ORG_LOC, "product_writeoff", legacyMain));
    check(
      "C2-5b",
      "старый основной QR в организации с точками — 0 документов и имя ответственного",
      (await countDocs(ORG_LOC, "product_writeoff")) === 0 && legacyPage.html.includes("Нина Точкова"),
      { snippet: legacyPage.html.slice(legacyPage.html.indexOf("<main"), legacyPage.html.indexOf("<main") + 500) }
    );
    const foreign = token(ORG_LOC, "glass_control", null, { buildingId: state.buildings.foreign });
    const foreignPage = await get(pageUrl(ORG_LOC, "glass_control", foreign));
    check(
      "C2-5c",
      "здание чужой организации в b~ — «ссылка недействительна», 0 документов",
      foreignPage.html.includes("Ссылка недействительна") && (await countDocs(ORG_LOC, "glass_control")) === 0,
      { status: foreignPage.status }
    );
    const b2Main = token(ORG_LOC, "metal_impurity", null, { buildingId: state.buildings.b2 });
    const b2Page = await get(pageUrl(ORG_LOC, "metal_impurity", b2Main));
    check(
      "C2-5d",
      "основной QR точки показывает документы только своей точки",
      b2Page.html.includes(`value="${state.docs.locMetalB2}"`) && !b2Page.html.includes(state.docs.locMetalB1),
      { status: b2Page.status }
    );
  }

  // ---- C3-3. JSON-API: журналы объектов закрыты для хаба и основного QR журнала (ревью безопасности)
  {
    const ip = () => `10.8.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
    const post = (code: string, tok: string, documentId: string, values: Record<string, unknown>) =>
      fetch(apiUrl(ORG, code), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip() },
        body: JSON.stringify({ token: tok, documentId, employeeId: state.users.cook, rowKey: `employee-${state.users.cook}`, values }),
      }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));
    const hub = token(ORG, "all");
    const entriesBefore = await db.journalDocumentEntry.count({ where: { documentId: { in: [state.docs.uv, state.docs.cold] } } });
    const daily = await fetch(`${apiUrl(ORG, "hygiene")}?token=${encodeURIComponent(hub)}&daily=1&employeeId=${state.users.cook}`);
    const dailyText = await daily.text();
    check("C3-3a", "daily=1 с токеном хаба не раскрывает id документов УФ и холодильников", daily.status === 200 && !dailyText.includes(state.docs.uv) && !dailyText.includes(state.docs.cold), { status: daily.status, body: dailyText.slice(0, 300) });
    const results: Record<string, number> = {};
    for (const [code, doc] of [["uv_lamp_runtime", state.docs.uv], ["cold_equipment_control", state.docs.cold]] as const) {
      for (const [kind, tok] of [["hub", hub], ["main", token(ORG, code)]] as const) {
        const apiGet = await fetch(`${apiUrl(ORG, code)}?token=${encodeURIComponent(tok)}&documentId=${doc}&employeeId=${state.users.cook}`);
        results[`GET ${code} ${kind}`] = apiGet.status;
        const apiPost = await post(code, tok, doc, { startTime: "08:00", endTime: "09:00", temperature: 4 });
        results[`POST ${code} ${kind}`] = apiPost.status;
      }
    }
    check("C3-3b", "GET и POST /api/journal-fill для УФ и холодильников по хабу и основному QR → 403", Object.values(results).every((status) => status === 403), results);
    const entriesAfter = await db.journalDocumentEntry.count({ where: { documentId: { in: [state.docs.uv, state.docs.cold] } } });
    check("C3-3c", "в журналы объектов ничего не записано", entriesBefore === entriesAfter, { entriesBefore, entriesAfter });
  }

  // ---- C2-6. Отключённый журнал не открывается и не пишется через JSON-API
  {
    const hub = token(ORG, "all");
    const original = await db.organization.findUnique({ where: { id: ORG }, select: { disabledJournalCodes: true } });
    await db.organization.update({ where: { id: ORG }, data: { disabledJournalCodes: ["metal_impurity"] } });
    try {
      const entriesBefore = await db.journalDocumentEntry.count({ where: { documentId: state.docs.metalA } });
      const apiGet = await fetch(`${apiUrl(ORG, "metal_impurity")}?token=${encodeURIComponent(hub)}&documentId=${state.docs.metalA}&employeeId=${state.users.cook}`);
      const apiPost = await fetch(apiUrl(ORG, "metal_impurity"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.7.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` },
        body: JSON.stringify({ token: hub, documentId: state.docs.metalA, employeeId: state.users.cook, rowKey: `employee-${state.users.cook}`, values: {} }),
      });
      const postBody = await apiPost.json().catch(() => null);
      check("C2-6a", "отключённый журнал: GET и POST по токену хаба → 403", apiGet.status === 403 && apiPost.status === 403, { get: apiGet.status, post: apiPost.status, postBody });
      check("C2-6b", "в отключённый журнал ничего не записано", (await db.journalDocumentEntry.count({ where: { documentId: state.docs.metalA } })) === entriesBefore);
    } finally {
      await db.organization.update({ where: { id: ORG }, data: { disabledJournalCodes: (original?.disabledJournalCodes ?? []) as never } });
    }
  }

  const failed = checks.filter((item) => !item.ok);
  fs.writeFileSync(path.join(HERE, "core-e2e.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
