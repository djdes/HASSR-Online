// E2E частей C–E: кнопка QR ведёт на нужные плакаты/наклейки (C-1…C-4),
// QR работает через смену периода — документ создаётся по образцу прошлого
// (C-5…C-7), страховки (C-8), идемпотентность (C-9), золотой блок кнопок
// (D-1, D-2) и QR-кнопка на каждом журнале (E-1).
// Стенд: npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/qr-setup.ts
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/qr-e2e.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { journalQrHref } from "../../../../src/lib/journal-qr-target";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "qr-state.json"), "utf8"));
const ORG: string = state.org;
const TODAY: string = state.today;
const DAY = new Date(`${TODAY}T00:00:00.000Z`);
// Секрет QR-токена — тот же, что у dev-сервера (из .env берём только его).
for (const line of fs.readFileSync(path.join(HERE, "..", "..", "..", "..", ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);

const checks: Array<{ id: string; name: string; ok: boolean; detail?: unknown }> = [];
function check(id: string, name: string, ok: boolean, detail?: unknown) {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}
const wants = (id: string) => ONLY.length === 0 || ONLY.some((prefix) => id.startsWith(prefix));

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

async function goto(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await page.goto(url, { waitUntil: "load", timeout: 240_000 }).catch(() => null);
    if (response && response.status() < 500) return response;
    await page.waitForTimeout(3_000);
  }
  return page.goto(url, { waitUntil: "load", timeout: 240_000 });
}

async function dismissModals(page: Page) {
  await page.locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]').click({ timeout: 2_000 }).catch(() => {});
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible().catch(() => false)) {
    await page.locator("div.fixed.inset-0 input[type=checkbox]").first().check().catch(() => {});
    await terms.click().catch(() => {});
    await terms.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
  }
}

async function login(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await goto(page, `${BASE}/login`);
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return page;
  }
  throw new Error(`login failed: ${email}`);
}

type Poster = { id: string; url: string; kind: string; notice: string | null };
async function posters(page: Page, query: string): Promise<{ url: string; posters: Poster[]; text: string }> {
  await goto(page, `${BASE}/settings/qr-posters?${query}&origin=${encodeURIComponent(BASE)}`);
  await page.waitForSelector("h1", { timeout: 120_000 });
  await dismissModals(page);
  const list = await page.$$eval("[data-qr-poster]", (nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-qr-id") ?? "",
      url: node.getAttribute("data-qr-url") ?? "",
      kind: node.getAttribute("data-qr-kind") ?? "",
      notice: node.querySelector("[data-qr-notice]")?.textContent?.trim() ?? null,
    }))
  );
  return { url: page.url(), posters: list, text: await page.locator("main").innerText().catch(() => "") };
}

/** URL из QR — на наш стенд (домен ссылок мог быть другим). */
const local = (qrUrl: string) => {
  const url = new URL(qrUrl);
  return `${BASE}${url.pathname}${url.search}`;
};
const tokenOf = (qrUrl: string) => new URL(qrUrl).searchParams.get("token") ?? "";

async function activeToday(code: string) {
  return db.journalDocument.findMany({
    where: { organizationId: ORG, status: "active", template: { code }, dateFrom: { lte: DAY }, dateTo: { gte: DAY } },
    select: { id: true, title: true, dateFrom: true, dateTo: true, config: true, responsibleUserId: true, verifierUserId: true },
  });
}
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

async function noOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  const browser: Browser = await chromium.launch({ channel: "chrome" });
  const managerDesk = await browser.newContext(DESKTOP);
  const managerMob = await browser.newContext(MOBILE);
  const cookDesk = await browser.newContext(DESKTOP);
  const anon = await browser.newContext(MOBILE);
  try {
    const manager = await login(managerDesk, state.users.manager.email);
    await dismissModals(manager);

    // ---------------------------------------------------------------- C-1
    let checklistPoster: Poster | undefined;
    if (wants("C-1") || wants("C-5") || wants("C-6")) {
      const res = await posters(manager, "kind=journals&ids=cleaning_ventilation_checklist");
      checklistPoster = res.posters.find((p) => p.id === "cleaning_ventilation_checklist");
      check("C-1", "плакат журнала без документа на сегодня собирается (нет «не найдено»)", res.posters.length === 1 && Boolean(checklistPoster), res.posters.map((p) => p.id));
      check("C-1", "подсказка «прошлый период закончился — откроется новый по образцу»", /Прошлый период закончился/.test(checklistPoster?.notice ?? ""), checklistPoster?.notice);
      check("C-1", "нет пустого состояния «Выбранные объекты не найдены»", !res.text.includes("Выбранные объекты не найдены"));
      await manager.screenshot({ path: path.join(SHOTS, "qr-c1-poster-notice.png"), fullPage: true });
    }

    // ---------------------------------------------------------------- C-2 объекты
    let coldStickers: Poster[] = [];
    let roomStickers: Poster[] = [];
    let lampStickers: Poster[] = [];
    if (wants("C-2") || wants("C-7")) {
      const cold = await posters(manager, "kind=journals&ids=cold_equipment_control");
      // С 733d5137 страница журнала объектов — это основной QR журнала
      // (data-qr-kind="journal", id = код) + наклейки его объектов, без редиректа.
      const coldMain = cold.posters.filter((p) => p.kind === "journal");
      coldStickers = cold.posters.filter((p) => p.kind !== "journal");
      check(
        "C-2",
        "журнал холодильников: основной QR журнала + наклейки его холодильников",
        coldMain.length === 1 && coldMain[0].id === "cold_equipment_control" && coldStickers.every((p) => p.kind === "equipment"),
        cold.posters.map((p) => [p.kind, p.id])
      );
      check(
        "C-2",
        "наклейки — холодильник и морозильник прошлого документа (списанный отсечён)",
        coldStickers.length === 2 && coldStickers.some((p) => p.id === state.equipment.fridge) && coldStickers.some((p) => p.id === state.equipment.freezer),
        coldStickers.map((p) => p.id)
      );
      check("C-2", "вместо «Выбранные объекты не найдены» — область журнала", !cold.text.includes("Выбранные объекты не найдены") && cold.text.includes("Наклейки на объекты"), cold.text.slice(0, 300));
      await manager.screenshot({ path: path.join(SHOTS, "qr-c2-cold-stickers.png"), fullPage: true });

      const climate = await posters(manager, new URL(journalQrHref("climate_control"), BASE).search.slice(1));
      roomStickers = climate.posters.filter((p) => p.kind !== "journal");
      check("C-2", "климат: основной QR журнала + наклейки обоих складов", climate.posters.some((p) => p.kind === "journal" && p.id === "climate_control") && roomStickers.length === 2 && roomStickers.every((p) => p.kind === "room"), climate.posters.map((p) => [p.kind, p.id]));
      const uv = await posters(manager, new URL(journalQrHref("uv_lamp_runtime"), BASE).search.slice(1));
      lampStickers = uv.posters.filter((p) => p.kind !== "journal");
      check("C-2", "УФ: основной QR журнала + наклейка лампы", uv.posters.some((p) => p.kind === "journal" && p.id === "uv_lamp_runtime") && lampStickers.length === 1 && lampStickers[0].id === state.equipment.lamp, uv.posters.map((p) => [p.kind, p.id]));
      const mismatched = await posters(manager, "kind=rooms&journal=cold_equipment_control");
      // Вид нормализуется на сервере без смены URL: показываются наклейки холодильников.
      const mismatchedStickers = mismatched.posters.filter((p) => p.kind !== "journal");
      check(
        "C-2",
        "вид не совпал с журналом (склады ↔ холодильники) — на верные наклейки",
        mismatchedStickers.length === 2 && mismatchedStickers.every((p) => p.kind === "equipment") && mismatchedStickers.some((p) => p.id === state.equipment.fridge),
        mismatched.posters.map((p) => [p.kind, p.id])
      );
    }

    // ---------------------------------------------------------------- C-3 kind=journal, гигиена
    if (wants("C-3")) {
      const singular = await posters(manager, "kind=journal");
      check("C-3", "kind=journal (единственное число) — журналы, а не склады", singular.posters.some((p) => p.id === "all") && singular.posters.every((p) => p.kind === "journal"), singular.posters.map((p) => p.id));
      const hygiene = await posters(manager, new URL(journalQrHref("hygiene"), BASE).search.slice(1));
      check(
        "C-3",
        "гигиена: оба плаката — сотрудникам и «допуск»",
        hygiene.posters.map((p) => p.id).sort().join(",") === "hygiene,hygiene@verify",
        hygiene.posters.map((p) => p.id)
      );
      check("C-3", "журнал без документов — подсказка «создастся при первом сканировании»", hygiene.posters.every((p) => /Документа ещё нет — он создастся при первом сканировании/.test(p.notice ?? "")), hygiene.posters.map((p) => p.notice));
      const lapsedHub = singular.posters.find((p) => p.id === "cleaning_ventilation_checklist" || p.id === "metal_impurity");
      check("C-3", "лист «все журналы» включает журналы с кончившимся периодом", Boolean(lapsedHub), singular.posters.map((p) => p.id));
    }

    // ---------------------------------------------------------------- C-4 код:документ, неизвестный код
    let oldDocPoster: Poster | undefined;
    if (wants("C-4") || wants("C-6")) {
      const res = await posters(manager, `kind=journals&ids=${encodeURIComponent(`cleaning_ventilation_checklist:${state.docs.checklistPrev}`)}`);
      // Основной QR журнала + дополнительный QR этого документа.
      oldDocPoster = res.posters.find((p) => p.id === `cleaning_ventilation_checklist:${state.docs.checklistPrev}`);
      check(
        "C-4",
        "ids=код:документ (печать из превью документа) — основной QR журнала и QR этого документа",
        res.posters.length === 2 && res.posters[0].id === "cleaning_ventilation_checklist" && Boolean(oldDocPoster),
        res.posters.map((p) => p.id)
      );
      const unknown = await posters(manager, "kind=journals&ids=no_such_journal");
      check("C-4", "неизвестный журнал — причина, а не молчаливая пустота", unknown.posters.length === 0 && unknown.text.includes("Такого журнала нет") && unknown.text.includes("Журнал не найден"), unknown.text.slice(0, 400));
      await manager.screenshot({ path: path.join(SHOTS, "qr-c4-missing-reason.png"), fullPage: true });
    }

    // ---------------------------------------------------------------- C-5 переход периода по QR
    const scan = await anon.newPage();
    if (wants("C-5") && checklistPoster) {
      const before = await activeToday("cleaning_ventilation_checklist");
      check("C-5", "до скана документа на сегодня нет (цепочка прервана)", before.length === 0, before.map((d) => d.id));
      await goto(scan, `${local(checklistPoster.url)}&employee=${state.users.cook.id}`);
      const formShown = await scan.locator("#qr-form").waitFor({ timeout: 120_000 }).then(() => true).catch(() => false);
      check("C-5", "скан 1-го числа: форма открылась как обычно", formShown, (await scan.locator("main").innerText().catch(() => "")).slice(0, 300));
      await scan.screenshot({ path: path.join(SHOTS, "qr-c5-form.png"), fullPage: true });
      const after = await activeToday("cleaning_ventilation_checklist");
      const created = after[0];
      check("C-5", "создан ровно один документ текущего периода", after.length === 1 && isoDay(created.dateFrom) === state.periods.curMonthFrom && isoDay(created.dateTo) === state.periods.curMonthTo, after.map((d) => [d.id, isoDay(d.dateFrom), isoDay(d.dateTo)]));
      check("C-5", "ответственный — из прошлого документа", created?.responsibleUserId === state.users.manager.id, created?.responsibleUserId);
      const old = await db.journalDocument.findUnique({ where: { id: state.docs.checklistPrev }, select: { status: true } });
      check("C-5", "прошлый период ушёл в «Закрытые» (как у ночного крона)", old?.status === "closed", old);
      const audit = await db.auditLog.findFirst({ where: { organizationId: ORG, action: "journal_document.qr_rollover", entityId: created?.id } });
      check("C-5", "создание записано в журнал аудита", Boolean(audit), audit?.details);
      const bell = await db.notification.findFirst({ where: { organizationId: ORG, userId: state.users.manager.id, kind: "journal.qr-rollover", dedupeKey: `qr-rollover:${created?.id}` } });
      check("C-5", "руководителю — колокольчик «Начат новый период…»", Boolean(bell) && /Начат новый период/.test(bell?.title ?? ""), bell?.title);
      if (formShown) {
        await scan.locator("#qr-form button[type=submit]").first().click();
        const saved = await scan.locator(".ok").waitFor({ timeout: 120_000 }).then(() => true).catch(() => false);
        const text = await scan.locator("main").innerText().catch(() => "");
        check("C-5", "«Сохранить» — запись принята", saved && text.includes(created?.title ?? "???"), text.slice(0, 300));
        await scan.screenshot({ path: path.join(SHOTS, "qr-c5-saved.png"), fullPage: true });
        const entry = await db.journalDocumentEntry.findFirst({ where: { documentId: created?.id, employeeId: state.users.cook.id, date: DAY } });
        check("C-5", "запись лежит в документе нового периода", Boolean(entry), entry?.data);
      }
    }

    // ---------------------------------------------------------------- C-6 плакат прошлого документа
    if (wants("C-6") && oldDocPoster) {
      const successor = (await activeToday("cleaning_ventilation_checklist"))[0];
      // С 733d5137 дополнительный QR документа, выпущенный сейчас, несёт подписанный
      // срок (конец периода) — у прошлого периода он уже истёк.
      await goto(scan, `${local(oldDocPoster.url)}&employee=${state.users.cook.id}`);
      const expiredText = await scan.locator("body").innerText().catch(() => "");
      check("C-6", "QR документа прошлого периода, напечатанный сейчас, — «срок закончился», отсылка к основному QR", /Срок этого QR-кода закончился/.test(expiredText) && /основной QR-код журнала/.test(expiredText), expiredText.slice(0, 300));
      // Старые напечатанные коды (без срока в подписи) работают как раньше.
      const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
      const legacyToken = mintQrFillToken("journal", `${ORG}:cleaning_ventilation_checklist:${state.docs.checklistPrev}`);
      await goto(scan, `${BASE}/journal-fill/${ORG}/cleaning_ventilation_checklist?token=${encodeURIComponent(legacyToken)}&employee=${state.users.cook.id}`);
      const formShown = await scan.locator("#qr-form").waitFor({ timeout: 120_000 }).then(() => true).catch(() => false);
      check("C-6", "плакат, напечатанный из документа прошлого периода (старый код без срока), открывает форму", formShown, (await scan.locator("main").innerText().catch(() => "")).slice(0, 300));
      if (formShown) {
        await scan.locator("#qr-form button[type=submit]").first().click();
        await scan.locator(".ok").waitFor({ timeout: 120_000 }).catch(() => null);
        const text = await scan.locator("main").innerText().catch(() => "");
        check("C-6", "запись — в преемника той же линии, не в закрытый", Boolean(successor) && text.includes(successor.title) && !text.includes(state.periods.prevMonthFrom), text.slice(0, 300));
      }
    }

    // ---------------------------------------------------------------- C-7 наклейки объектов
    if (wants("C-7")) {
      const fridge = coldStickers.find((p) => p.id === state.equipment.fridge);
      if (fridge) {
        await goto(scan, local(fridge.url));
        await scan.waitForLoadState("networkidle").catch(() => null);
        const pageText = await scan.locator("body").innerText().catch(() => "");
        check("C-7", "наклейка холодильника 16-го: страница без «журнала на сегодня нет»", !pageText.includes("не входит ни в один активный журнал"), pageText.slice(0, 300));
        await scan.screenshot({ path: path.join(SHOTS, "qr-c7-cold-sticker.png"), fullPage: true });
        const response = await anon.request.post(`${BASE}/api/equipment-fill/${state.equipment.fridge}`, {
          data: { token: tokenOf(fridge.url), employeeId: state.users.cook.id, temperature: 4 },
        });
        check("C-7", "замер холодильника сохранён (200)", response.status() === 200, await response.text());
        const cold = (await activeToday("cold_equipment_control"))[0];
        const config = (cold?.config ?? {}) as { equipment?: Array<{ id: string; readingMode?: string }>; skipWeekends?: boolean };
        check(
          "C-7",
          "новый документ холодильников — те же холодильники без списанного, режим замеров и выходные",
          Boolean(cold) &&
            isoDay(cold.dateFrom) === `${TODAY.slice(0, 8)}${Number(TODAY.slice(8)) >= 16 ? "16" : "01"}` &&
            (config.equipment ?? []).map((item) => item.id).join(",") === "row-fridge,row-freezer" &&
            config.equipment?.[0]?.readingMode === "twice" &&
            config.skipWeekends === true,
          { id: cold?.id, from: cold && isoDay(cold.dateFrom), equipment: config.equipment, skipWeekends: config.skipWeekends }
        );
        const entry = cold ? await db.journalDocumentEntry.findFirst({ where: { documentId: cold.id, employeeId: state.users.cook.id, date: DAY } }) : null;
        check("C-7", "замер лёг в новый документ", Boolean(entry), entry?.data);
      } else check("C-7", "есть наклейка холодильника", false);

      const room1 = roomStickers.find((p) => p.id === state.rooms.room1);
      if (room1) {
        await goto(scan, local(room1.url));
        await scan.waitForLoadState("networkidle").catch(() => null);
        const response = await anon.request.post(`${BASE}/api/room-fill/${state.rooms.room1}`, {
          data: { token: tokenOf(room1.url), employeeId: state.users.cook.id, temperature: 18, humidity: 55 },
        });
        check("C-7", "замер склада сохранён (200)", response.status() === 200, await response.text());
        const climate = (await activeToday("climate_control"))[0];
        const config = (climate?.config ?? {}) as { rooms?: Array<{ roomId?: string }>; controlTimes?: string[] };
        check(
          "C-7",
          "новый документ климата — оба склада и сроки контроля 09:00/18:00",
          Boolean(climate) && (config.rooms ?? []).length === 2 && (config.controlTimes ?? []).join(",") === "09:00,18:00",
          { rooms: config.rooms?.map((room) => room.roomId), times: config.controlTimes }
        );
      } else check("C-7", "есть наклейка склада", false);

      const lamp = lampStickers[0];
      if (lamp) {
        const on = await anon.request.post(`${BASE}/api/equipment-fill/${state.equipment.lamp}/uv`, {
          data: { token: tokenOf(lamp.url), employeeId: state.users.manager.id, action: "on" },
        });
        const off = await anon.request.post(`${BASE}/api/equipment-fill/${state.equipment.lamp}/uv`, {
          data: { token: tokenOf(lamp.url), employeeId: state.users.manager.id, action: "off" },
        });
        check("C-7", "УФ-лампа: «Я включил» и «Я выключил» (200)", on.status() === 200 && off.status() === 200, [await on.text(), await off.text()]);
        const uvDocs = await activeToday("uv_lamp_runtime");
        const config = (uvDocs[0]?.config ?? {}) as { lampNumber?: string; areaName?: string; equipmentId?: string; spec?: { controlFrequency?: string } };
        check(
          "C-7",
          "УФ: документ нового месяца по образцу прошлого — номер, цех, паспорт",
          uvDocs.length === 1 && config.lampNumber === "7" && config.areaName === "Холодный цех" && config.equipmentId === state.equipment.lamp && config.spec?.controlFrequency === "ежедневно",
          { count: uvDocs.length, config }
        );
      } else check("C-7", "есть наклейка УФ-лампы", false);
    }

    // ---------------------------------------------------------------- C-5b структура журнала с «Сделать копию»
    if (wants("C-5")) {
      const res = await posters(manager, "kind=journals&ids=equipment_maintenance");
      const poster = res.posters[0];
      if (poster) await goto(scan, local(poster.url));
      const doc = (await activeToday("equipment_maintenance"))[0];
      const config = (doc?.config ?? {}) as { year?: number; rows?: Array<{ plan?: Record<string, string>; fact?: Record<string, string> }> };
      check(
        "C-5",
        "годовой ТО: новый год по образцу прошлого — план остался, отметки «сделано» обнулены",
        Boolean(doc) && config.year === Number(TODAY.slice(0, 4)) && config.rows?.[0]?.plan?.jan === "+" && config.rows?.[0]?.fact?.jan === "",
        { id: doc?.id, config }
      );
    }

    // ---------------------------------------------------------------- C-8 страховки
    if (wants("C-8")) {
      const writeoff = (await posters(manager, "kind=journals&ids=product_writeoff")).posters[0];
      check("C-8", "плакат журнала с закрытым периодом — подсказка руководителю", /закрыт/.test(writeoff?.notice ?? ""), writeoff?.notice);
      if (writeoff) {
        await goto(scan, `${local(writeoff.url)}&employee=${state.users.cook.id}`);
        const text = await scan.locator("body").innerText();
        check("C-8", "закрытый руководителем период: объяснение, новый документ не создан", text.includes("Документ за этот период закрыт руководителем — попросите вернуть его в активные.") && (await activeToday("product_writeoff")).length === 0, text.slice(0, 300));
        await scan.screenshot({ path: path.join(SHOTS, "qr-c8-closed.png"), fullPage: true });
      }
      const trace = (await posters(manager, "kind=journals&ids=traceability_test")).posters[0];
      if (trace) {
        await goto(scan, `${local(trace.url)}&employee=${state.users.cook.id}`);
        const text = await scan.locator("body").innerText();
        check("C-8", "выключенный журнал: не создаём", text.includes("Этот журнал отключён") && (await activeToday("traceability_test")).length === 0, text.slice(0, 200));
      } else check("C-8", "плакат выключенного журнала собирается", false);
      const perishable = (await posters(manager, "kind=journals&ids=perishable_rejection")).posters[0];
      if (perishable) {
        const before = (await activeToday("perishable_rejection")).length;
        await goto(scan, `${local(perishable.url)}&employee=${state.users.cook.id}`);
        const text = await scan.locator("body").innerText();
        // С 733d5137 основной QR журнала без документов создаёт первый документ.
        const formShown = await scan.locator("#qr-form").count().then((n) => n > 0).catch(() => false);
        const created = await activeToday("perishable_rejection");
        check("C-8", "без прошлого документа — основной QR создаёт первый документ, форма открыта", before === 0 && formShown && !text.includes("Попросите руководителя создать документ") && created.length === 1, { text: text.slice(0, 200), before, docs: created.length });
      }
      const fryer = (await posters(manager, "kind=journals&ids=fryer_oil")).posters[0];
      if (fryer) {
        await db.organization.update({ where: { id: ORG }, data: { subscriptionPlan: "paused" } });
        try {
          await goto(scan, `${local(fryer.url)}&employee=${state.users.cook.id}`);
          const text = await scan.locator("body").innerText();
          check("C-8", "приостановленный кабинет: объяснение, документ не создан", text.includes("Кабинет организации приостановлен") && (await activeToday("fryer_oil")).length === 0, text.slice(0, 200));
          await scan.screenshot({ path: path.join(SHOTS, "qr-c8-paused.png"), fullPage: true });
        } finally {
          await db.organization.update({ where: { id: ORG }, data: { subscriptionPlan: "pro" } });
        }
      }
    }

    // ---------------------------------------------------------------- C-9 идемпотентность
    if (wants("C-9")) {
      const metal = (await posters(manager, "kind=journals&ids=metal_impurity")).posters[0];
      if (metal) {
        const url = local(metal.url);
        const statuses = await Promise.all(Array.from({ length: 6 }, () => anon.request.get(url, { timeout: 240_000 }).then((r) => r.status()).catch(() => 0)));
        const docs = await activeToday("metal_impurity");
        const audits = await db.auditLog.count({ where: { organizationId: ORG, action: "journal_document.qr_rollover", entityId: { in: docs.map((doc) => doc.id) } } });
        check("C-9", "6 одновременных сканов — ровно один документ нового периода", docs.length === 1 && statuses.every((status) => status === 200), { docs: docs.length, statuses });
        check("C-9", "и одна запись аудита", audits === 1, audits);
      } else check("C-9", "плакат металлопримесей", false);
    }

    // ---------------------------------------------------------------- D-1 / D-2 блок кнопок
    type Box = { x: number; y: number; width: number; height: number };
    type Layout = {
      block: Box | null;
      h1: Box | null;
      qr: Box | null;
      qrText: string | null;
      qrHref: string | null;
      qrBg: string | null;
      sheenAnimation: string | null;
      second: Array<{ box: Box | null; text: string }>;
    };
    // Строкой, а не функцией: tsx/esbuild вставляет в функции хелпер __name,
    // которого нет в браузере.
    const LAYOUT_JS = `(() => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const block = document.querySelector("[data-journal-list-actions]");
      const cells = block ? Array.from(block.children) : [];
      const qr = block ? block.querySelector('[data-testid="journal-qr-point"]') : null;
      const qrStyle = qr ? getComputedStyle(qr) : null;
      const sheen = qr ? getComputedStyle(qr, "::after") : null;
      return {
        block: box(block),
        h1: box(document.querySelector("h1")),
        qr: box(qr),
        qrText: qr ? qr.textContent.trim() : null,
        qrHref: qr ? qr.getAttribute("href") : null,
        qrBg: qrStyle ? qrStyle.backgroundImage : null,
        sheenAnimation: sheen ? sheen.animationName : null,
        second: cells.filter((cell) => !cell.matches('[data-testid="journal-qr-point"]')).map((cell) => ({ box: box(cell), text: cell.innerText.trim() })),
      };
    })()`;
    const layout = async (page: Page): Promise<Layout> => page.evaluate(LAYOUT_JS) as Promise<Layout>;
    const gridOk = (l: Awaited<ReturnType<typeof layout>>, expectCreate: boolean) => {
      const blockBox = l.block as Box | null;
      const qr = l.qr as Box | null;
      if (!blockBox || !qr) return false;
      const qrFull = Math.abs(qr.width - blockBox.width) <= 2;
      if (!expectCreate) return qrFull && l.second.length === 1 && Math.abs((l.second[0].box as Box).width - blockBox.width) <= 2;
      const [create, guide] = l.second.map((cell) => cell.box as Box);
      return (
        qrFull &&
        l.second.length === 2 &&
        /Создать документ|Новая запись/.test(l.second[0].text) &&
        /Инструкция/.test(l.second[1].text) &&
        Math.abs(create.y - guide.y) <= 1 &&
        Math.abs(create.width - guide.width) <= 2 &&
        create.x < guide.x &&
        qr.y + qr.height <= create.y + 1
      );
    };
    if (wants("D-")) {
      const cases: Array<{ id: string; code: string; label: string; expectCreate: boolean }> = [
        { id: "D-1", code: "cleaning_ventilation_checklist", label: "общая шапка (JournalTopBar)", expectCreate: true },
        { id: "D-2", code: "accident_journal", label: "своя шапка журнала аварий", expectCreate: true },
        { id: "D-2", code: "product_writeoff", label: "своя шапка акта забраковки (CreateDocumentDialog)", expectCreate: true },
        { id: "D-2", code: "hygiene", label: "пустой журнал — «Создать» только в карточке, «Инструкция» на две колонки", expectCreate: false },
      ];
      const managerPhone = await login(managerMob, state.users.manager.email);
      for (const item of cases) {
        for (const [device, page] of [["mobile", managerPhone], ["desktop", manager]] as const) {
          await goto(page, `${BASE}/journals/${item.code}`);
          await page.locator('[data-testid="journal-qr-point"]').first().waitFor({ timeout: 120_000 }).catch(() => null);
          await dismissModals(page);
          await page.waitForTimeout(300);
          const l = await layout(page);
          check(item.id, `${item.label} · ${device}: QR над рядом «Создать | Инструкция»`, gridOk(l, item.expectCreate), l);
          check(item.id, `${item.label} · ${device}: «QR-точка контроля», золотой градиент`, l.qrText === "QR-точка контроля" && /linear-gradient/.test(l.qrBg ?? ""), { text: l.qrText, bg: l.qrBg });
          if (device === "desktop") {
            const block = l.block as Box;
            const h1 = l.h1 as Box;
            check(item.id, `${item.label} · desktop: блок 440 px справа от заголовка`, Math.abs(block.width - 440) <= 2 && block.x > h1.x + 100, { block, h1 });
            check(item.id, `${item.label} · desktop: блик — анимация qr-point-sheen`, l.sheenAnimation === "qr-point-sheen", l.sheenAnimation);
          } else {
            check(item.id, `${item.label} · mobile: блок во всю ширину, без горизонтальной прокрутки`, Math.abs((l.block as Box).width - (390 - 32)) <= 2 && (await noOverflow(page)), l.block);
          }
          await page.screenshot({ path: path.join(SHOTS, `qr-${item.id.toLowerCase()}-${item.code}-${device}.png`), fullPage: false });
        }
      }
      const reduced = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
      const reducedPage = await login(reduced, state.users.manager.email);
      await goto(reducedPage, `${BASE}/journals/cleaning_ventilation_checklist`);
      await reducedPage.locator('[data-testid="journal-qr-point"]').first().waitFor({ timeout: 120_000 }).catch(() => null);
      const rl = await layout(reducedPage);
      check("D-1", "«уменьшить движение»: блика нет", rl.sheenAnimation === "none", rl.sheenAnimation);
      await reduced.close();
    }

    // ---------------------------------------------------------------- E-1 кнопка на каждом журнале
    if (wants("E-1")) {
      const templates = await db.journalTemplate.findMany({ where: { isActive: true }, select: { code: true }, orderBy: { code: "asc" } });
      const disabled = new Set<string>(state.disabled);
      const missing: string[] = [];
      const wrongHref: Array<{ code: string; href: string | null }> = [];
      const closedMissing: string[] = [];
      for (const { code } of templates) {
        if (disabled.has(code)) continue;
        await goto(manager, `${BASE}/journals/${code}`);
        const qr = manager.locator('[data-testid="journal-qr-point"]').first();
        const visible = await qr.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
        if (!visible) {
          missing.push(code);
          continue;
        }
        const href = await qr.getAttribute("href");
        if (href !== journalQrHref(code)) wrongHref.push({ code, href });
        await goto(manager, `${BASE}/journals/${code}?tab=closed`);
        const closedVisible = await manager.locator('[data-testid="journal-qr-point"]').first().waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
        if (!closedVisible) closedMissing.push(code);
      }
      check("E-1", `руководитель видит «QR-точку контроля» на всех ${templates.length - disabled.size} журналах`, missing.length === 0, missing);
      check("E-1", "кнопка ведёт по правилу journalQrHref (объекты — наклейки)", wrongHref.length === 0, wrongHref);
      check("E-1", "и на вкладке «Закрытые»", closedMissing.length === 0, closedMissing);
      const cook = await login(cookDesk, state.users.cook.email);
      const seenByCook: string[] = [];
      for (const code of ["cleaning_ventilation_checklist", "accident_journal", "hygiene", "cold_equipment_control", "product_writeoff"]) {
        await goto(cook, `${BASE}/journals/${code}`);
        await cook.locator("[data-journal-list-actions]").first().waitFor({ timeout: 60_000 }).catch(() => null);
        if ((await cook.locator('[data-testid="journal-qr-point"]').count()) > 0) seenByCook.push(code);
      }
      check("E-1", "повару QR-кнопки нет (плакаты печатает руководитель)", seenByCook.length === 0, seenByCook);
      await cook.screenshot({ path: path.join(SHOTS, "qr-e1-cook-no-qr.png") });
    }
  } finally {
    await browser.close();
    const passed = checks.filter((item) => item.ok).length;
    const summary = { passed, failed: checks.length - passed, total: checks.length, checks };
    fs.writeFileSync(path.join(HERE, ONLY.length ? `qr-e2e-${ONLY.join("_")}.json` : "qr-e2e.json"), JSON.stringify(summary, null, 2));
    console.log(`\n${passed}/${checks.length} passed`);
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
