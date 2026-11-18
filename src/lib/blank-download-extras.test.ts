import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXTAUTH_SECRET = "test-secret-for-blank-extras-0123456789";

import JSZip from "jszip";

import { buildBlankDownloadAdminText } from "@/lib/blank-download";
import {
  BLANK_EXTRAS_FIELD_MAX,
  BLANK_EXTRAS_MAX_ROWS,
  blankEquipmentType,
  blankExtrasAdminLine,
  blankExtrasEquipmentRows,
  blankExtrasSections,
  countBlankExtras,
  normalizeBlankExtras,
} from "@/lib/blank-download-extras";
import { blankFileQrUrl } from "@/lib/blank-download-extras.server";
import { signBlankDownloadToken, verifyBlankDownloadToken } from "@/lib/blank-download-token";
import { parseBlankDownloadRequest } from "@/lib/blank-download-targets";
import { renderJournalDocumentDocx } from "@/lib/document-docx";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { buildJournalBlankInput } from "@/lib/journal-sample-fixtures";

/**
 * «Дополнительно» в окне скачивания шаблона (спека
 * blank-download-extras-2026-11): какие поля у какого журнала, чистка
 * ввода, счётчик для Telegram, токен ссылки, печать в бланке и QR кабинета.
 */

test("AC3: разделы «Дополнительно» зависят от журнала, ответственный — у всех", () => {
  assert.deepEqual(blankExtrasSections("hygiene"), { employees: true, equipment: null, rooms: false });
  assert.deepEqual(blankExtrasSections("health_check"), { employees: true, equipment: null, rooms: false });
  assert.deepEqual(blankExtrasSections("cold_equipment_control"), { employees: false, equipment: "cold", rooms: false });
  assert.deepEqual(blankExtrasSections("fryer_oil"), { employees: false, equipment: "generic", rooms: false });
  assert.deepEqual(blankExtrasSections("cleaning"), { employees: false, equipment: null, rooms: true });
  assert.deepEqual(blankExtrasSections("climate_control"), { employees: false, equipment: null, rooms: true });
  assert.deepEqual(blankExtrasSections("finished_product"), { employees: false, equipment: null, rooms: false });
  assert.deepEqual(blankExtrasSections(null), { employees: false, equipment: null, rooms: false });
});

test("AC4: ввод чистится, режется и не пускает чужие журналу разделы", () => {
  const long = "Я".repeat(BLANK_EXTRAS_FIELD_MAX + 20);
  const raw = {
    responsible: { name: "  Иванова   Мария ", position: " Заведующая " },
    employees: [
      { name: "Петров\nСергей", position: "Повар" },
      { name: "   ", position: "Без имени" },
      { name: long },
      ...Array.from({ length: 20 }, (_, i) => ({ name: `Сотрудник ${i}` })),
    ],
    equipment: [{ name: "Холодильник" }],
    rooms: ["Цех"],
  };
  const extras = normalizeBlankExtras(raw, "hygiene");
  assert.ok(extras);
  assert.deepEqual(extras.responsible, { name: "Иванова Мария", position: "Заведующая" });
  assert.equal(extras.employees?.length, BLANK_EXTRAS_MAX_ROWS);
  assert.deepEqual(extras.employees?.[0], { name: "Петров Сергей", position: "Повар" });
  assert.equal(extras.employees?.[1].name.length, BLANK_EXTRAS_FIELD_MAX);
  assert.equal(extras.equipment, undefined, "у гигиенического нет оборудования");
  assert.equal(extras.rooms, undefined, "у гигиенического нет помещений");

  const cold = normalizeBlankExtras({ equipment: [{ name: "Ларь", kind: "freezer" }, { name: "Витрина", kind: "что-то" }] }, "cold_equipment_control");
  assert.deepEqual(cold?.equipment, [{ name: "Ларь", kind: "freezer" }, { name: "Витрина", kind: "fridge" }]);
  const fryer = normalizeBlankExtras({ equipment: [{ name: "Фритюрница", kind: "freezer" }] }, "fryer_oil");
  assert.deepEqual(fryer?.equipment, [{ name: "Фритюрница" }], "у некохолодильного оборудования нет типа");
  const rooms = normalizeBlankExtras({ rooms: ["Горячий цех", "Горячий цех", "", 42, "Моечная"] }, "cleaning");
  assert.deepEqual(rooms?.rooms, ["Горячий цех", "Моечная"]);

  for (const empty of [null, undefined, "строка", [], {}, { responsible: { name: " " } }, { employees: "x" }]) {
    assert.equal(normalizeBlankExtras(empty, "hygiene"), null);
  }
});

test("AC4/AC7: счётчик и строка для Telegram", () => {
  const extras = normalizeBlankExtras(
    { responsible: { name: "Иванова" }, employees: [{ name: "А" }, { name: "Б" }, { name: "В" }] },
    "hygiene",
  );
  assert.deepEqual(countBlankExtras(extras), { total: 4, responsible: 1, employees: 3, equipment: 0, rooms: 0 });
  assert.equal(blankExtrasAdminLine(extras), "➕ Доп. данные: 4 (ответственный, сотрудники — 3)");
  assert.equal(blankExtrasAdminLine(null), null);
  const rooms = normalizeBlankExtras({ rooms: ["Цех", "Склад"] }, "cleaning");
  assert.equal(blankExtrasAdminLine(rooms), "➕ Доп. данные: 2 (помещения — 2)");
});

test("AC7: уведомление — флаг и местное время, число доп. данных; без них — как раньше", () => {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const text = buildBlankDownloadAdminText({
    title: "Гигиенический журнал (сотрудники)",
    format: "docx",
    email: "a@example.com",
    phone: "+79101234567",
    source: "Поиск Яндекса",
    location: "🇷🇺 Россия, Москва · 14:32",
    adminUrl: "https://wesetup.ru/root/organizations/o1",
    extras: normalizeBlankExtras({ employees: [{ name: "А" }, { name: "Б" }] }, "hygiene"),
    accountCreated: true,
    escape,
  });
  const lines = text.split("\n");
  assert.ok(lines.includes("🇷🇺 Россия, Москва · 14:32"));
  assert.equal(lines[lines.indexOf("🇷🇺 Россия, Москва · 14:32") - 1], "Источник: Поиск Яндекса");
  assert.ok(lines.includes("➕ Доп. данные: 2 (сотрудники — 2)"));
  assert.equal(lines.at(-2), "✅ Кабинет создан, доступ отправлен");
  assert.equal(lines.at(-1), '<a href="https://wesetup.ru/root/organizations/o1">Открыть</a>');
  const plain = buildBlankDownloadAdminText({ title: "Журнал", format: "pdf", email: "a@example.com", escape });
  assert.equal(plain, "📥 Скачивание журнала: Журнал (PDF)\nПочта: a@example.com");
});

test("AC6: тип оборудования и нормы для кабинета", () => {
  assert.equal(blankEquipmentType("cold_equipment_control", "fridge"), "refrigerator");
  assert.equal(blankEquipmentType("cold_equipment_control", "freezer"), "freezer");
  assert.equal(blankEquipmentType("fryer_oil"), "fryer");
  assert.equal(blankEquipmentType("uv_lamp_runtime"), "uv_lamp");
  assert.equal(blankEquipmentType("equipment_maintenance"), "other");
  const rows = blankExtrasEquipmentRows(
    normalizeBlankExtras({ equipment: [{ name: "Ларь", kind: "freezer" }, { name: "Шкаф" }] }, "cold_equipment_control"),
    "cold_equipment_control",
  );
  assert.deepEqual(rows, [
    { name: "Ларь", type: "freezer", tempMin: -24, tempMax: -18 },
    { name: "Шкаф", type: "refrigerator", tempMin: 2, tempMax: 6 },
  ]);
});

test("AC3: запрос API разбирает extras и tz, мусор не отвергает скачивание", () => {
  const parsed = parseBlankDownloadRequest(
    {
      email: "a@example.com",
      code: "hygiene",
      format: "pdf",
      consent: true,
      tz: "Asia/Yekaterinburg",
      extras: { employees: [{ name: "Петров", position: "Повар" }], rooms: ["лишнее"] },
    },
    "v1",
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value.extras, { employees: [{ name: "Петров", position: "Повар" }] });
    assert.equal(parsed.value.timeZone, "Asia/Yekaterinburg");
  }
  const junk = parseBlankDownloadRequest({ email: "a@example.com", code: "hygiene", format: "pdf", consent: true, extras: "junk", tz: 5 }, "v1");
  assert.equal(junk.ok, true);
  if (junk.ok) {
    assert.equal(junk.value.extras, undefined);
    assert.equal(junk.value.timeZone, undefined);
  }
});

test("AC6: токен ссылки несёт id доп. данных и организацию; подделать нельзя", () => {
  const target = { kind: "code", code: "hygiene" } as const;
  const token = signBlankDownloadToken({ email: "a@example.com", target, format: "pdf", extrasRef: "cmconsent123", organizationId: "cmorg456" });
  const check = verifyBlankDownloadToken(token, { target, format: "pdf" });
  assert.equal(check.ok, true);
  if (check.ok) {
    assert.equal(check.extrasRef, "cmconsent123");
    assert.equal(check.organizationId, "cmorg456");
  }
  const plain = verifyBlankDownloadToken(signBlankDownloadToken({ email: "a@example.com", target, format: "pdf" }), { target, format: "pdf" });
  assert.equal(plain.ok && (plain.extrasRef ?? plain.organizationId), undefined);
  const bad = signBlankDownloadToken({ email: "a@example.com", target, format: "pdf", organizationId: "../../etc" });
  const badCheck = verifyBlankDownloadToken(bad, { target, format: "pdf" });
  assert.equal(badCheck.ok && badCheck.organizationId, undefined, "непохожий на id не попадает в токен");
});

test("AC6: QR файла — журнал кабинета при автоРеге, иначе /qb", () => {
  const target = { kind: "code", code: "hygiene" } as const;
  const cabinet = blankFileQrUrl({ origin: "https://wesetup.ru", target, email: "a@example.com", organizationId: "cmorg456" });
  assert.match(cabinet, /^https:\/\/wesetup\.ru\/qj\/cmorg456\/hygiene\/[A-Za-z0-9_-]+$/);
  const guest = blankFileQrUrl({ origin: "https://wesetup.ru", target, email: "a@example.com" });
  assert.match(guest, /^https:\/\/wesetup\.ru\/qb\/[A-Z2-7]+$/);
  const paper = blankFileQrUrl({ origin: "https://wesetup.ru", target: { kind: "paper", paperId: "ot_intro" }, email: null, organizationId: "cmorg456" });
  assert.match(paper, /\/qb\//, "бумажный бланк в кабинете с телефона не заполняют");
});

async function pdfText(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return texts.join(" ").replace(/\s+/g, " ");
  } finally {
    await task.destroy();
  }
}

test("AC5: сотрудники попадают в PDF и Word гигиенического журнала", async () => {
  const extras = normalizeBlankExtras(
    {
      responsible: { name: "Иванова Мария", position: "Заведующая" },
      employees: [{ name: "Петров Сергей", position: "Шеф-повар" }, { name: "Сидорова Анна" }],
    },
    "hygiene",
  );
  const input = buildJournalBlankInput("hygiene", { company: "ООО «Вкус»", extras });
  assert.deepEqual(input.users.map((user) => user.name), ["Петров Сергей", "Сидорова Анна"]);
  assert.equal(input.document.responsibleTitle, "Заведующая Иванова Мария");

  const pdf = await pdfText(renderJournalDocumentPdf(input).buffer);
  assert.ok(pdf.includes("Петров Сергей"), "сотрудник в PDF");
  assert.ok(pdf.includes("Сидорова Анна"), "второй сотрудник в PDF");

  const docx = await renderJournalDocumentDocx(input, "hygiene");
  const xml = await (await JSZip.loadAsync(docx.buffer)).file("word/document.xml")!.async("string");
  assert.ok(xml.includes("Петров Сергей"), "сотрудник в Word");
  assert.ok(xml.includes("Шеф-повар"), "должность в Word");
  assert.ok(xml.includes("Ответственный: Заведующая Иванова Мария"), "ответственный в Word");
});

test("AC5: оборудование и помещения попадают в бланки; без доп. данных бланк прежний", async () => {
  const cold = buildJournalBlankInput("cold_equipment_control", {
    extras: normalizeBlankExtras({ equipment: [{ name: "Витрина «Десерты»", kind: "fridge" }, { name: "Ларь для заморозки", kind: "freezer" }] }, "cold_equipment_control"),
  });
  const coldPdf = await pdfText(renderJournalDocumentPdf(cold).buffer);
  assert.ok(coldPdf.includes("Витрина «Десерты»"), "холодильник в PDF");
  assert.ok(coldPdf.includes("Ларь для заморозки"), "морозильник в PDF");

  for (const code of ["cleaning", "climate_control"] as const) {
    const input = buildJournalBlankInput(code, { extras: normalizeBlankExtras({ rooms: ["Кондитерский цех", "Склад овощей"] }, code) });
    const text = await pdfText(renderJournalDocumentPdf(input).buffer);
    assert.ok(text.includes("Кондитерский цех"), `${code}: помещение в PDF`);
    assert.ok(!text.includes("Горячий цех"), `${code}: помещения образца не подмешиваются`);
  }

  const before = buildJournalBlankInput("hygiene", { company: "ООО «Вкус»" });
  assert.equal(before.users.length, 0);
  assert.equal(before.document.responsibleTitle, null);
  const cleaning = buildJournalBlankInput("cleaning");
  assert.ok(cleaning.rooms.some((room) => room.name === "Горячий цех"), "пустой шаблон уборки — с помещениями по умолчанию");
});
