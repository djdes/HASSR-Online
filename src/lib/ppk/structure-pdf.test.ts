import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

import { buildDocumentOrgBlock } from "@/lib/document-org-block";
import { ppkPrintOrgFromBlock } from "./print-org";
import { PPK_STRUCTURE_ITEMS } from "./structure";
import { buildPpkStructurePdfWithLayout, planPrintFiles } from "./structure-pdf";
import type { PpkBundle } from "./assemble.server";
import type { PpkPrintData, PrintFile } from "./structure-print.server";

// 1×1 PNG — картинка-скан и «подпись».
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function pdfWithPages(count: number, blank = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) {
    const page = doc.addPage([595, 842]);
    if (!blank) page.drawRectangle({ x: 50, y: 50, width: 200, height: 100 });
  }
  return doc.save();
}

async function docx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document><w:body>${text.split("\n").map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

const file = (id: string, fileName: string, mimeType: string, bytes: Uint8Array, title = fileName): PrintFile => ({
  id,
  title,
  fileName,
  mimeType,
  sizeBytes: bytes.byteLength,
  bytes,
});

function bundle(): PpkBundle {
  return {
    org: ppkPrintOrgFromBlock(buildDocumentOrgBlock({ org: { name: "ООО «Тест»", inn: "7700000000", address: "Москва" } })),
    team: [{ userId: "u1", role: "leader", duties: "", name: "Иванов Иван", title: "Шеф-повар" }],
    policy: { text: "Политика.", approvedAt: null, approvedByName: null },
    products: [],
    flowcharts: [],
    hazards: [{ id: "h1", step: "Приёмка", hazard: "Сальмонелла", type: "bio", probability: 3, severity: 4, measures: "Входной контроль" }],
    points: [],
    norms: ["СанПиН 2.3/2.4.3590-20"],
    lab: [],
    pest: [],
    journals: [{ code: "hygiene", name: "Гигиенический журнал" }],
    staffCount: 1,
    positions: ["Шеф-повар"],
    responsibles: [],
    roster: [{ name: "Иванов Иван", title: "Шеф-повар" }],
    approvals: { ppk: null, "haccp-plan": null },
  } as unknown as PpkBundle;
}

function data(overrides: Partial<PpkPrintData> = {}): PpkPrintData {
  return {
    bundle: bundle(),
    timeZone: "Europe/Moscow",
    orgName: "ООО «Тест»",
    generalInfo: [["Наименование", "ООО «Тест»"]],
    orgCharts: [],
    contracts: [],
    production: [["Объект", "Кафе"]],
    floorPlans: [],
    docs: {},
    teamOrders: [],
    teamOrderScans: [],
    prp: {
      "prp-infections": { heads: ["Мероприятие"], rows: [["Мыть руки"]] },
      "prp-disinfection": { heads: ["Объект"], rows: [] },
      "prp-emergencies": { heads: ["Ситуация"], rows: [["Отключение воды"]] },
      "prp-medical": { heads: ["Должность"], rows: [] },
    },
    staffByPosition: [{ title: "Шеф-повар", names: ["Иванов Иван"] }],
    officials: [["Иванов Иван", "Шеф-повар", "Руководитель группы ХАССП"]],
    acks: null,
    pendingNames: [],
    equipment: [],
    labFiles: [],
    procedures: [],
    instructions: [],
    ...overrides,
  };
}

test("структура: титул, содержание, все 32 пункта по порядку, номера страниц сходятся", async () => {
  const { pdf, layout } = await buildPpkStructurePdfWithLayout(data());
  const loaded = await PDFDocument.load(pdf);
  assert.equal(loaded.getPageCount(), layout.totalPages);
  assert.ok(layout.tocPages >= 1);
  let previous = 0;
  for (const item of PPK_STRUCTURE_ITEMS) {
    const page = layout.itemPages[item.id];
    assert.ok(page, `пункт ${item.id} напечатан`);
    assert.ok(page > 1 + layout.tocPages, `пункт ${item.id} после содержания`);
    assert.ok(page >= previous, `пункт ${item.id} по порядку`);
    previous = page;
  }
  for (const key of ["primary", "plan", "prp", "appendix"]) assert.ok(layout.itemPages[`section:${key}`], key);
  // Колонтитул на всех страницах, кроме титульной.
  for (let page = 2; page <= layout.totalPages; page += 1) assert.ok(layout.labels[page], `колонтитул стр. ${page}`);
});

test("сканы встают страницами: PDF на 2 страницы и картинка; битый файл — строкой", async () => {
  const policyScan = file("s1", "politika.pdf", "application/pdf", await pdfWithPages(2), "Политика (скан)");
  const image = file("s2", "instr.png", "image/png", PNG, "Мойка рук");
  const broken = file("s3", "broken.pdf", "application/pdf", Buffer.from("%PDF-1.4 not really"), "Битый");
  const base = await buildPpkStructurePdfWithLayout(data());
  const { pdf, layout } = await buildPpkStructurePdfWithLayout(
    data({
      docs: { "2-1": { title: "Политика в области безопасности пищевой продукции", revision: "ППК 004 от 24.11.2026", text: "Политика.", files: [policyScan] } },
      instructions: [
        { title: "Мойка рук", revision: null, text: null, files: [image] },
        { title: "Битый", revision: null, text: null, files: [broken] },
      ],
    }),
  );
  assert.equal(layout.scanPages.length, 3);
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), layout.totalPages);
  assert.ok(layout.totalPages >= base.layout.totalPages + 3, `${layout.totalPages} vs ${base.layout.totalPages}`);
  // Страницы скана политики — под колонтитулом с номером редакции.
  for (const page of layout.scanPages.slice(0, 2)) assert.match(layout.labels[page], /ППК 004 от 24\.11\.2026/);
  // Неутверждённая инструкция — «Редакция не утверждена».
  assert.match(layout.labels[layout.scanPages[2]], /Редакция не утверждена/);
});

test("пустая страница скана (без содержимого) не ломает сборку", async () => {
  const blank = file("b1", "blank.pdf", "application/pdf", await pdfWithPages(2, true), "Пустой скан");
  const { pdf, layout } = await buildPpkStructurePdfWithLayout(
    data({ docs: { "2-2": { title: "Положение о группе ХАССП", revision: null, text: "Текст", files: [blank] } } }),
  );
  assert.equal(layout.scanPages.length, 2);
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), layout.totalPages);
});

test("документ текстом и DOCX печатаются текстом с шапкой", async () => {
  const word = file("d1", "proc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", await docx("Приёмка\nПроверить температуру"), "Приёмка");
  const { layout } = await buildPpkStructurePdfWithLayout(
    data({
      procedures: [{ title: "Приёмка", revision: "ППК 002 от 20.11.2026", text: null, files: [word] }],
      instructions: [{ title: "Личная гигиена", revision: "ППК 001 от 19.11.2026", text: "Мыть руки.\n\nНосить спецодежду.", files: [] }],
    }),
  );
  assert.equal(layout.scanPages.length, 0);
  assert.ok(layout.labels.some((label) => label?.includes("Приёмка · ППК 002 от 20.11.2026")));
  assert.ok(layout.labels.some((label) => label?.includes("Личная гигиена · ППК 001 от 19.11.2026")));
});

test("лист ознакомления 3.7 с подписью пальцем и PIN-кодом собирается", async () => {
  const { pdf } = await buildPpkStructurePdfWithLayout(
    data({
      acks: [
        { name: "Иванов Иван", title: "Шеф-повар", at: "2026-11-24T10:00:00.000Z", method: "finger", signature: new Uint8Array(PNG) },
        { name: "Петрова Анна", title: "Повар", at: "2026-11-24T11:00:00.000Z", method: "pin", signature: null },
      ],
      pendingNames: [{ name: "Сидоров Пётр", title: "Мойщик" }],
    }),
  );
  assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");
});

test("планирование файлов: пределы, битые и непрочитанные файлы — строкой", async () => {
  const plans = await planPrintFiles([
    file("a", "a.pdf", "application/pdf", await pdfWithPages(3)),
    file("b", "b.png", "image/png", PNG),
    file("c", "c.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Uint8Array([1, 2, 3])),
    file("d", "d.pdf", "application/pdf", Buffer.from("garbage")),
    { ...file("e", "e.pdf", "application/pdf", new Uint8Array()), sizeBytes: 90 * 1024 * 1024 },
  ]);
  assert.deepEqual(plans.get("a"), { kind: "pdf", pages: 3 });
  assert.deepEqual(plans.get("b"), { kind: "image", format: "png" });
  assert.deepEqual(plans.get("c"), { kind: "skip", reason: "format" });
  assert.deepEqual(plans.get("d"), { kind: "skip", reason: "broken" });
  assert.deepEqual(plans.get("e"), { kind: "skip", reason: "limit" });
});
