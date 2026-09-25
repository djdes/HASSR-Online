// e2e qr-forms-followups-2026-09: «Обслуживание»/«Ремонт» в общей QR-форме журнала
// холодильников (AC1), «Камера» приказов на сенсорных экранах любой ширины (AC2), поле
// температуры в карточках холодильников показывает число целиком (AC3).
//
// Запуск (своя база wesetup_wt_qrforms, dev на 3042):
//   npx tsx --env-file=.env .agent/tasks/qr-forms-followups-2026-09/e2e/qr-followups.ts
//
// AC1 и доступ к форме. На живом маршруте `/journal-fill/<org>/cold_equipment_control`
// журнал холодильников — «журнал объекта»: основной QR показывает только статус за сегодня
// (решения 33d8559b / f4f2da11, заполнение — по наклейке на самом холодильнике), и форма там
// не открывается — это тоже проверяется ниже. Чтобы пройти саму форму целиком, скрипт поднимает
// свой HTTP-сервер на НАСТОЯЩИХ обработчиках маршрута (`GET`/`POST` из route.ts → общее ядро
// `submitJournalFill` → адаптер → своя база) и в этом процессе снимает только запрет «журнал
// объекта» для cold_equipment_control. Всё остальное — токен, выбор сотрудника, PIN, разбор
// формы, запись, экран «Записано» — боевой код. Документ и печать смотрим на dev-сервере.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { GET as fillGET, POST as fillPOST } from "@/app/journal-fill/[orgId]/[code]/route";
import { db } from "@/lib/db";
import {
  expandColdEquipmentReadingSlots,
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
  type ColdEquipmentReadingSlot,
} from "@/lib/cold-equipment-document";
import { mintEquipmentQrToken } from "@/lib/equipment-qr-token";
import { OBJECT_QR_JOURNAL_CODES } from "@/lib/journal-fill";
import { setEmployeeQrPin } from "@/lib/qr-fill-actor";
import { journalShortSig, mintQrFillToken } from "@/lib/qr-fill-token";

import { DESKTOP_1440, PHONE_390, login, measureColdCards } from "./measure-cold-cards";

const BASE = process.env.BASE ?? "http://localhost:3042";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "evidence");
fs.mkdirSync(SHOTS, { recursive: true });
const CODE = "cold_equipment_control";
const PIN_A = "2580";
const PIN_B = "1470";

const checks: Array<{ ac: string; name: string; ok: boolean; detail?: unknown }> = [];
const check = (ac: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ ac, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
};
const consoleErrors: Record<string, string[]> = {};
function watchConsole(page: Page, label: string) {
  page.on("console", (msg) => {
    if (msg.type() === "error") (consoleErrors[label] ??= []).push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => (consoleErrors[label] ??= []).push(`pageerror: ${String(err).slice(0, 300)}`));
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const TABLET_1024_TOUCH = { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU" };
const DESKTOP_1024 = { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, locale: "ru-RU" };

async function clipShot(page: Page, locator: ReturnType<Page["locator"]>, file: string, pad = 12) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await locator.boundingBox();
  const vw = page.viewportSize()!.width;
  const x = Math.max(0, (box?.x ?? 0) - pad);
  await page.screenshot({
    path: path.join(SHOTS, file),
    ...(box ? { clip: { x, y: Math.max(0, box.y - pad), width: Math.min(box.width + pad * 2, vw - x), height: box.height + pad * 2 } } : {}),
  });
}

// ---------------------------------------------------------------- фикстуры

type Fixture = {
  orgId: string;
  docId: string;
  dateFrom: Date;
  slots: { X: ColdEquipmentReadingSlot; Y: ColdEquipmentReadingSlot; Z: ColdEquipmentReadingSlot; W: ColdEquipmentReadingSlot };
  cookA: { id: string; name: string };
  cookB: { id: string; name: string };
  hygieneDocId: string;
};

async function setup(): Promise<Fixture> {
  const org = await db.organization.findFirstOrThrow({ where: { name: "Ресторан «Вкусная Гавань»" }, select: { id: true } });
  const doc = await db.journalDocument.findFirstOrThrow({
    where: { organizationId: org.id, status: "active", template: { code: CODE } },
    select: { id: true, config: true, dateFrom: true },
  });
  const config = normalizeColdEquipmentDocumentConfig(doc.config);
  // Замер «1 раз в день» с оборудованием из справочника (наклейка пишет в него).
  const single = expandColdEquipmentReadingSlots(config).filter((slot) => slot.slotCount === 1 && slot.sourceEquipmentId);
  if (single.length < 4) throw new Error(`нужно 4 холодильника с наклейкой, есть ${single.length}`);
  const [X, Y, Z, W] = single;
  const people = await db.user.findMany({
    where: { organizationId: org.id, isActive: true, archivedAt: null, role: { notIn: ["owner", "manager", "head_chef", "technologist"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 2,
  });
  if (people.length < 2) throw new Error("нужно два сотрудника");
  const [cookA, cookB] = people;
  for (const [person, pin] of [[cookA, PIN_A], [cookB, PIN_B]] as const) {
    const err = await setEmployeeQrPin(person.id, pin);
    if (err) throw new Error(`PIN: ${err}`);
  }
  // Кто заполняет по наклейке: не ограничено (иначе сотрудник Б получил бы отказ).
  await db.equipment.update({ where: { id: X.sourceEquipmentId! }, data: { fillerUserIds: [] } }).catch(() => null);
  // Повторный прогон — сегодняшние записи холодильников с чистого листа.
  await db.journalDocumentEntry.deleteMany({ where: { documentId: doc.id, date: new Date(`${todayKey()}T00:00:00.000Z`) } });
  const hygiene = await db.journalDocument.findFirstOrThrow({ where: { organizationId: org.id, status: "active", template: { code: "hygiene" } }, select: { id: true } });
  return { orgId: org.id, docId: doc.id, dateFrom: doc.dateFrom, slots: { X, Y, Z, W }, cookA, cookB, hygieneDocId: hygiene.id };
}

// ---------------------------------------------------------------- стенд формы (боевые обработчики)

async function startHarness(): Promise<{ origin: string; close: () => Promise<void> }> {
  // Единственное отличие от прода: основной QR холодильников открывает форму, а не статус.
  (OBJECT_QR_JOURNAL_CODES as Set<string>).delete(CODE);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const match = /^\/journal-fill\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (!match) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }
      const request = new Request(url.toString(), { method: req.method, headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
      const ctx = { params: Promise.resolve({ orgId: decodeURIComponent(match[1]), code: decodeURIComponent(match[2]) }) };
      const response = req.method === "POST" ? await fillPOST(request, ctx) : await fillGET(request, ctx);
      const out: Record<string, string | string[]> = {};
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") out[key] = value;
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) out["set-cookie"] = cookies;
      res.writeHead(response.status, out);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error("[harness]", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(err));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

// ---------------------------------------------------------------- AC1

const fieldSel = (slot: ColdEquipmentReadingSlot) => `[id="f-t_${slot.slotKey}"]`;
const markLabel = (slot: ColdEquipmentReadingSlot, value: "service" | "repair") => `label:has(> input[name="status:t_${slot.slotKey}"][value="${value}"])`;
const markInput = (slot: ColdEquipmentReadingSlot, value: "service" | "repair") => `input[name="status:t_${slot.slotKey}"][value="${value}"]`;
const offLabel = (slot: ColdEquipmentReadingSlot) => `label:has(> input[name="off:t_${slot.slotKey}"])`;
const offInput = (slot: ColdEquipmentReadingSlot) => `input[name="off:t_${slot.slotKey}"]`;

async function fieldState(page: Page, slot: ColdEquipmentReadingSlot) {
  // Без именованных функций внутри evaluate: tsx оборачивает их в `__name`, которого нет в браузере.
  return page.evaluate((key) => {
    const input = document.getElementById(`f-t_${key}`) as HTMLInputElement | null;
    const wrap = input?.closest(".fl") as HTMLElement | null;
    const status = Array.from(document.getElementsByName(`status:t_${key}`)).find((el) => (el as HTMLInputElement).checked) as HTMLInputElement | undefined;
    const off = Array.from(document.getElementsByName(`off:t_${key}`)).some((el) => (el as HTMLInputElement).checked);
    return {
      value: input?.value ?? null,
      dimmed: wrap?.classList.contains("is-off") ?? null,
      required: input?.hasAttribute("aria-required") ?? null,
      note: wrap?.querySelector(".st")?.textContent ?? null,
      status: status?.value ?? null,
      off,
    };
  }, slot.slotKey);
}

/** Выбор сотрудника (если спросили) и PIN (если нет 30-минутного пропуска «Запомнить выбор»). */
async function pickEmployeeAndPin(page: Page, employeeId: string, pin: string) {
  // Кнопки сотрудников есть и в скрытой шторке «Сменить» — жмём только на шаге выбора.
  const pick = page.locator(`button[name="employee"][value="${employeeId}"]`);
  if ((await pick.count()) && (await pick.first().isVisible())) {
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), pick.first().click()]);
  }
  await page.locator("#qp-pin, #qr-form").first().waitFor({ timeout: 60_000 });
  if (await page.locator("#qp-pin").count()) {
    await page.fill("#qp-pin", pin);
    await Promise.all([page.waitForURL(/[?&]ok=1/, { timeout: 60_000 }), page.click("#qr-pin button[type=submit]")]);
  }
  await page.locator("#qr-form").waitFor({ timeout: 60_000 });
}

async function fillInRange(page: Page, skip: Set<string>) {
  const inputs = page.locator('#qr-form input[id^="f-t_"]');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const id = (await input.getAttribute("id")) ?? "";
    if (skip.has(id.slice(2))) continue;
    if ((await input.inputValue()).trim() !== "") continue;
    const min = Number(await input.getAttribute("data-min"));
    const max = Number(await input.getAttribute("data-max"));
    const value = Number.isFinite(min) && Number.isFinite(max) ? String(Math.round((min + max) / 2)) : "4";
    await input.fill(value);
  }
}

async function ac1(browser: Browser, fx: Fixture) {
  const { X, Y, Z, W } = fx.slots;
  const token = mintQrFillToken("journal", `${fx.orgId}:${CODE}`);
  const path_ = `/journal-fill/${fx.orgId}/${CODE}?token=${encodeURIComponent(token)}`;

  // Живой маршрут: основной QR холодильников — только статус (форма — по наклейке).
  const live = await fetch(`${BASE}${path_}`, { redirect: "manual" });
  const liveHtml = await live.text();
  check("AC1", "живой маршрут: у журнала холодильников основной QR — только «Статус за сегодня», формы нет", live.status === 200 && /Статус за сегодня/.test(liveHtml) && !/id="qr-form"/.test(liveHtml), { status: live.status });

  // Наклейка (dev-сервер): сотрудник Б ставит «Обслуживание» холодильнику X.
  const sticker = await fetch(`${BASE}/api/equipment-fill/${X.sourceEquipmentId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: mintEquipmentQrToken(X.sourceEquipmentId!), employeeId: fx.cookB.id, status: "service", pin: PIN_B }),
  });
  check("AC1", "наклейка: «Обслуживание» у X записано (200)", sticker.ok, { status: sticker.status, body: (await sticker.text()).slice(0, 200) });

  let wValue = 3;
  const harness = await startHarness();
  const context = await browser.newContext(PHONE_390);
  const page = await context.newPage();
  watchConsole(page, "qr-form");
  try {
    await page.goto(`${harness.origin}${path_}`, { waitUntil: "load", timeout: 120_000 });
    await pickEmployeeAndPin(page, fx.cookA.id, PIN_A);

    // Кнопки есть у каждого холодильника; с наклейки X — «Обслуживание» уже выбрано.
    const radios = await page.locator('#qr-form input[type=radio][name^="status:"]').count();
    const fields = await page.locator('#qr-form input[id^="f-t_"]').count();
    check("AC1", "у каждого замера холодильника «Обслуживание» и «Ремонт»", radios === fields * 2 && fields >= 4, { radios, fields });
    const x0 = await fieldState(page, X);
    check("AC1", "отметка с наклейки подставлена: X — «Обслуживание», поле пустое и погашено", x0.status === "service" && x0.dimmed === true && x0.value === "" && x0.required === false && /в журнал «обсл»/.test(x0.note ?? ""), x0);

    // Y: вне нормы → блок отклонения; «Ремонт» гасит поле и снимает проверку нормы.
    await page.locator(fieldSel(Y)).fill("25");
    const devShown = await page.locator("#deviation").isVisible();
    await page.locator(markLabel(Y, "repair")).click();
    const y1 = await fieldState(page, Y);
    const devAfter = await page.locator("#deviation").isVisible();
    check("AC1", "«Ремонт»: поле очищено, погашено, не обязательно, норма не проверяется", devShown && !devAfter && y1.status === "repair" && y1.value === "" && y1.dimmed === true && y1.required === false && /в журнал «рем», норма не проверяется/.test(y1.note ?? ""), { devShown, devAfter, y1 });
    // Взаимоисключение с «Выключено» в обе стороны.
    await page.locator(offLabel(Y)).click();
    const y2 = await fieldState(page, Y);
    await page.locator(markLabel(Y, "service")).click();
    const y3 = await fieldState(page, Y);
    await page.locator(markLabel(Y, "repair")).click();
    const y4 = await fieldState(page, Y);
    check("AC1", "«Выключено», «Обслуживание», «Ремонт» взаимоисключающие", y2.off && y2.status === null && y3.status === "service" && !y3.off && y4.status === "repair" && !y4.off, { y2, y3, y4 });
    // Повторное касание снимает отметку — поле снова обязательно.
    await page.locator(markLabel(Y, "repair")).click();
    const y5 = await fieldState(page, Y);
    await page.locator(markLabel(Y, "repair")).click();
    const y6 = await fieldState(page, Y);
    check("AC1", "повторное касание снимает «Ремонт», поле снова обязательное", y5.status === null && y5.dimmed === false && y5.required === true && y6.status === "repair", { y5, y6 });

    // W — тоже «Ремонт»; Z оставляем пустым → ошибка, выбор должен сохраниться.
    await page.locator(markLabel(W, "repair")).click();
    await fillInRange(page, new Set([`t_${X.slotKey}`, `t_${Y.slotKey}`, `t_${Z.slotKey}`, `t_${W.slotKey}`]));
    await page.locator(fieldSel(Y)).scrollIntoViewIfNeeded();
    await clipShot(page, page.locator(fieldSel(Y)).locator("xpath=ancestor::div[contains(@class,'obj')][1]"), "ac1-qr-fridge-repair-390.png", 8);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("#qr-form button[type=submit]")]);
    const err = (await page.locator(".err").first().textContent().catch(() => "")) ?? "";
    const xR = await fieldState(page, X);
    const yR = await fieldState(page, Y);
    const wR = await fieldState(page, W);
    check("AC1", "ошибка «Не заполнено» только про пустой Z, с подсказкой про «Обслуживание»/«Ремонт»", /Не заполнено/.test(err) && err.includes(Z.name) && !err.includes(Y.name) && /«Обслуживание» или «Ремонт»/.test(err), err);
    check("AC1", "повторный показ формы сохраняет выбор (X «Обслуживание», Y и W «Ремонт»)", xR.status === "service" && yR.status === "repair" && wR.status === "repair" && yR.dimmed === true && yR.value === "", { xR, yR, wR });

    await page.locator(fieldSel(Z)).fill("4");
    await fillInRange(page, new Set([`t_${X.slotKey}`, `t_${Y.slotKey}`, `t_${W.slotKey}`]));
    await Promise.all([page.waitForURL(/done=updated/, { timeout: 60_000 }), page.click("#qr-form button[type=submit]")]);
    const done = (await page.locator('[role="status"]').first().textContent()) ?? "";
    check("AC1", "«Записано»: отмечено «Обслуживание» или «Ремонт»: 3", /Отмечено «Обслуживание» или «Ремонт»: 3/.test(done), done.slice(0, 300));

    const day = new Date(`${todayKey()}T00:00:00.000Z`);
    const own = normalizeColdEquipmentEntryData(
      (await db.journalDocumentEntry.findUnique({ where: { documentId_employeeId_date: { documentId: fx.docId, employeeId: fx.cookA.id, date: day } }, select: { data: true } }))?.data ?? null
    );
    check(
      "AC1",
      "в записи — как с наклейки: statuses X=service, Y=repair, W=repair, температуры null; Z=4; без «Выключено» и комментариев",
      own.statuses?.[X.slotKey] === "service" && own.statuses?.[Y.slotKey] === "repair" && own.statuses?.[W.slotKey] === "repair" &&
        own.temperatures[X.slotKey] === null && own.temperatures[Y.slotKey] === null && own.temperatures[W.slotKey] === null &&
        own.temperatures[Z.slotKey] === 4 && !own.corrections?.[Y.slotKey] && !own.corrections?.[W.slotKey],
      own
    );
    const stickerEntry = normalizeColdEquipmentEntryData(
      (await db.journalDocumentEntry.findUnique({ where: { documentId_employeeId_date: { documentId: fx.docId, employeeId: fx.cookB.id, date: day } }, select: { data: true } }))?.data ?? null
    );
    check("AC1", "запись с наклейки не тронута (X — service у сотрудника Б)", stickerEntry.statuses?.[X.slotKey] === "service", stickerEntry.statuses);

    // Визит 2: снять отметку у W и ввести температуру — отметка снимается (как с наклейки).
    await page.goto(`${harness.origin}${path_}`, { waitUntil: "load" });
    await pickEmployeeAndPin(page, fx.cookA.id, PIN_A);
    const w0 = await fieldState(page, W);
    const z0 = await fieldState(page, Z);
    check("AC1", "повторное открытие: своя отметка W «Ремонт» выбрана, Z=4 подставлено", w0.status === "repair" && z0.value === "4", { w0, z0 });
    await page.locator(markLabel(W, "repair")).click();
    // Температура в норме этого холодильника (середина нормы).
    const wMin = Number(await page.locator(fieldSel(W)).getAttribute("data-min"));
    const wMax = Number(await page.locator(fieldSel(W)).getAttribute("data-max"));
    wValue = Number.isFinite(wMin) && Number.isFinite(wMax) ? Math.round((wMin + wMax) / 2) : 3;
    await page.locator(fieldSel(W)).fill(String(wValue));
    await Promise.all([page.waitForURL(/done=updated/, { timeout: 60_000 }), page.click("#qr-form button[type=submit]")]);
    const own2 = normalizeColdEquipmentEntryData(
      (await db.journalDocumentEntry.findUnique({ where: { documentId_employeeId_date: { documentId: fx.docId, employeeId: fx.cookA.id, date: day } }, select: { data: true } }))?.data ?? null
    );
    check("AC1", `снятие отметки + температура: W=${wValue} без отметки, Y «рем» и X «обсл» на месте`, own2.temperatures[W.slotKey] === wValue && !own2.statuses?.[W.slotKey] && own2.statuses?.[Y.slotKey] === "repair" && own2.statuses?.[X.slotKey] === "service", own2);
  } finally {
    await context.close();
    await harness.close();
  }

  // Документ на сайте и печать (dev-сервер).
  const desk = await browser.newContext(DESKTOP_1440);
  await desk.addInitScript(() => {
    try {
      localStorage.setItem("journal-mobile-view:cold_equipment_control", "table");
    } catch {}
  });
  const site = await login(desk);
  watchConsole(site, "site-cold-table");
  await site.goto(`${BASE}/journals/${CODE}/documents/${fx.docId}`, { waitUntil: "load", timeout: 240_000 });
  await site.locator("td input[type=text]").first().waitFor({ timeout: 240_000 });
  const dayIndex = Math.round((new Date(`${todayKey()}T00:00:00Z`).getTime() - new Date(fx.dateFrom).getTime()) / 86400000);
  const cell = (slot: ColdEquipmentReadingSlot) => site.locator("tr", { hasText: slot.name }).first().locator("td[data-grid-day]").nth(dayIndex).locator("input");
  const cells = { X: await cell(X).inputValue(), Y: await cell(Y).inputValue(), Z: await cell(Z).inputValue(), W: await cell(W).inputValue() };
  check("AC1", `в документе на сайте: X «обсл», Y «рем», Z 4, W ${wValue}`, cells.X === "обсл" && cells.Y === "рем" && cells.Z === "4" && cells.W === String(wValue), cells);
  await clipShot(site, site.locator("tr", { hasText: Y.name }).first().locator("xpath=ancestor::table[1]"), "ac1-site-cold-table-1440.png", 4);

  const pdf = await site.request.get(`${BASE}/api/journal-documents/${fx.docId}/pdf`, { timeout: 240_000 });
  const bytes = new Uint8Array(await pdf.body());
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loaded = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise;
  let text = "";
  for (let n = 1; n <= loaded.numPages; n += 1) {
    const content = await (await loaded.getPage(n)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
  }
  check("AC1", "в печати (PDF) есть «обсл» и «рем»", pdf.ok() && /обсл/.test(text) && /(^|[^а-яё])рем([^а-яё]|$)/i.test(text), { status: pdf.status(), obsl: (text.match(/обсл/g) ?? []).length, rem: (text.match(/(^|[^а-яё])рем(?=[^а-яё]|$)/gi) ?? []).length });
  await desk.close();

  // Сверх спеки: живой основной QR журнала («Статус за сегодня») называет «обсл»/«рем», а не «замера ещё нет».
  const status = await (await fetch(`${BASE}${path_}`)).text();
  const itemOf = (name: string) => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<small>([^<]*)</small>`).exec(status)?.[1] ?? null;
  const summaries = { X: itemOf(X.name), Y: itemOf(Y.name), Z: itemOf(Z.name) };
  check("AC1+", "«Статус за сегодня» (живой QR журнала): X «обслуживание — в журнале «обсл»», Y «ремонт — в журнале «рем»»", summaries.X === "обслуживание — в журнале «обсл»" && summaries.Y === "ремонт — в журнале «рем»" && /^замер снят/.test(summaries.Z ?? ""), summaries);
}

// ---------------------------------------------------------------- AC2

async function ac2(browser: Browser, fx: Fixture) {
  const hygieneQr = `/qj/${fx.orgId}/hygiene/${journalShortSig(fx.orgId, "hygiene")}`;
  const devices: Array<{ name: string; opts: Parameters<Browser["newContext"]>[0]; touch: boolean; shot?: { site?: string; qr?: string } }> = [
    { name: "телефон 390 (touch)", opts: PHONE_390, touch: true },
    { name: "планшет 1024 (touch)", opts: TABLET_1024_TOUCH, touch: true, shot: { site: "ac2-site-tablet-1024-touch.png", qr: "ac2-qr-tablet-1024-touch.png" } },
    { name: "компьютер 1024 (мышь)", opts: DESKTOP_1024, touch: false, shot: { site: "ac2-site-desktop-1024.png" } },
    { name: "компьютер 1440 (мышь)", opts: DESKTOP_1440, touch: false, shot: { qr: "ac2-qr-desktop-1440.png" } },
  ];
  for (const device of devices) {
    const context = await browser.newContext(device.opts);
    const page = await login(context);
    watchConsole(page, `site-hygiene ${device.name}`);
    await page.goto(`${BASE}/journals/hygiene/documents/${fx.hygieneDocId}`, { waitUntil: "load", timeout: 240_000 });
    const panel = page.locator("[data-order-scans]");
    await panel.waitFor({ timeout: 240_000 });
    await panel.scrollIntoViewIfNeeded();
    const media = await page.evaluate(() => ({ pointerCoarse: matchMedia("(pointer: coarse)").matches, anyPointerCoarse: matchMedia("(any-pointer: coarse)").matches, width: innerWidth }));
    const cameraVisible = await page.locator("[data-order-scan-camera]").isVisible();
    const uploadVisible = await page.getByRole("button", { name: /Загрузить/ }).first().isVisible();
    check("AC2", `сайт, ${device.name}: «Камера» ${device.touch ? "видна" : "скрыта"}, «Загрузить» есть`, cameraVisible === device.touch && uploadVisible && media.anyPointerCoarse === device.touch, { cameraVisible, uploadVisible, media });
    if (device.shot?.site) await clipShot(page, panel, device.shot.site, 8);

    // QR-страница гигиены: руководитель вошёл в кабинет, заполняет сотрудник с PIN.
    await page.goto(`${BASE}${hygieneQr}`, { waitUntil: "load", timeout: 240_000 });
    const pick = page.locator(`button[name="employee"][value="${fx.cookA.id}"]`);
    if (await pick.count()) await Promise.all([page.waitForNavigation({ waitUntil: "load" }), pick.first().click()]);
    await page.locator("#qp-pin").waitFor({ timeout: 120_000 });
    await page.fill("#qp-pin", PIN_A);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("#qr-pin button[type=submit]")]);
    const block = page.locator("#order-scans");
    await block.waitFor({ timeout: 120_000 });
    await block.scrollIntoViewIfNeeded();
    const qrCamera = await page.locator("#order-scans .oscan-cam").isVisible();
    const qrDesk = await page.locator("#order-scans .oscan-desk").isVisible();
    const deskLink = await page.locator("#order-scans .oscan-desk a").getAttribute("href").catch(() => null);
    check(
      "AC2",
      `QR-страница, ${device.name}: «Сфотографировать приказ» ${device.touch ? "видна" : "скрыта, вместо неё — «загрузите файл в кабинете»"}`,
      qrCamera === device.touch && qrDesk === !device.touch && /^\/journals\/hygiene\/documents\/[^/]+$/.test(deskLink ?? ""),
      { qrCamera, qrDesk, deskLink }
    );
    if (device.shot?.qr) await clipShot(page, block, device.shot.qr, 8);
    await context.close();
  }
}

// ---------------------------------------------------------------- AC3

async function ac3(browser: Browser, fx: Fixture) {
  const result = (await measureColdCards(browser, fx.docId, "ac3")) as Record<string, Array<{ inputWidth: number; textArea: number; need: number; fits: boolean; toolsBelow: boolean | null; overflowsCard: boolean }>>;
  for (const [key, rows] of Object.entries(result)) {
    check("AC3", `${key}: «-18,5» помещается в поле (место под текст ≥ ширины числа), кнопки не вылезают`, rows.length > 0 && rows.every((row) => row.fits && !row.overflowsCard), rows.map((row) => ({ w: row.inputWidth, text: row.textArea, need: row.need, below: row.toolsBelow })));
  }
}

async function main() {
  const only = process.argv[2] ?? "all";
  const browser = await chromium.launch({ headless: true });
  try {
    const fx = await setup();
    if (only === "all" || only === "ac1") await ac1(browser, fx);
    if (only === "all" || only === "ac2") await ac2(browser, fx);
    if (only === "all" || only === "ac3") await ac3(browser, fx);
  } catch (err) {
    check("run", "сценарий без исключений", false, String(err instanceof Error ? err.stack : err));
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(HERE, `qr-followups${process.argv[2] ? `-${process.argv[2]}` : ""}.json`), JSON.stringify({ at: new Date().toISOString(), base: BASE, checks, consoleErrors }, null, 2));
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  if (Object.keys(consoleErrors).length > 0) console.log("console errors:", JSON.stringify(consoleErrors).slice(0, 1500));
  process.exit(failed.length ? 1 : 0);
}

void main();
