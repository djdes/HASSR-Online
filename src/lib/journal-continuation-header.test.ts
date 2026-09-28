import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "@napi-rs/canvas";

import { COLD_EQUIPMENT_LEGAL_BASIS } from "@/lib/cold-equipment-document";
import { renderJournalDocumentPdf, type JournalDocumentPdfInput } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { journalDocumentPdfQr, journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { JOURNAL_QR_COMPACT_MODULE_MM, journalQrCompact, journalQrTile } from "@/lib/pdf-journal-qr";
import { JOURNAL_SHEET_MARGIN_MM } from "@/lib/pdf-journal-sheet";

process.env.NEXTAUTH_SECRET ||= "journal-continuation-header-secret-0123456789";

/**
 * Компактная шапка продолжений (2026-09-28, владелец): на стр. 2..N — одна
 * строка «организация | название | СТР. X ИЗ N | QR», без «Периодичности
 * контроля» и «Начат / Окончен», QR меньше (код без знака и полосы,
 * коррекция M), таблица — ближе к шапке. Первая (титульная) страница — полная
 * шапка, как раньше.
 */

const M = JOURNAL_SHEET_MARGIN_MM;
const PT_TO_MM = 25.4 / 72;
const ORG_ID = "cmg7k2x9d0000qz8r4tv1abcd";

type Text = { text: string; x0: number; x1: number; top: number; baseline: number };
type Page = { texts: Text[]; widthMm: number; heightMm: number; ink: (xMm: number, yMm: number) => boolean };

async function inspect(pdf: Buffer): Promise<Page[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const pages: Page[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const heightMm = base.height * PT_TO_MM;
      const content = await page.getTextContent();
      const texts: Text[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const t = item.transform as number[];
        const size = Math.hypot(t[2], t[3]) * PT_TO_MM;
        const baseline = heightMm - t[5] * PT_TO_MM;
        texts.push({ text: item.str, x0: t[4] * PT_TO_MM, x1: (t[4] + item.width) * PT_TO_MM, top: baseline - size * 0.7, baseline });
      }
      const dpi = 150;
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<
        typeof page.render
      >[0]).promise;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const k = dpi / 25.4;
      const ink = (xMm: number, yMm: number) => {
        const i = (Math.floor(yMm * k) * canvas.width + Math.floor(xMm * k)) * 4;
        return Math.min(data[i], data[i + 1], data[i + 2]) < 160;
      };
      pages.push({ texts, widthMm: base.width * PT_TO_MM, heightMm, ink });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

const has = (page: Page, needle: string) => page.texts.some((t) => t.text.includes(needle));

/** Холодильники на несколько страниц: 45 единиц оборудования. */
function longColdEquipmentInput(): JournalDocumentPdfInput {
  const sample = buildJournalSampleInput("cold_equipment_control");
  const config = JSON.parse(JSON.stringify(sample.document.config)) as { equipment: Array<Record<string, unknown>> };
  const base = config.equipment;
  config.equipment = Array.from({ length: 45 }, (_, i) => ({ ...base[i % base.length], id: `eq-long-${i}` }));
  return {
    ...sample,
    document: { ...sample.document, config: config as unknown as typeof sample.document.config },
    qr: journalDocumentPdfQr("https://wesetup.ru", ORG_ID, "cold_equipment_control"),
  };
}

test("длинный журнал: стр. 1 — полная шапка с периодичностью, стр. 2..N — компактная одна строка", async () => {
  const input = longColdEquipmentInput();
  const rendered = renderJournalDocumentPdf(input);
  const pages = await inspect(rendered.buffer);
  assert.ok(pages.length >= 2, `страниц ${pages.length}`);
  const [first, ...rest] = pages;
  // Титульная: полная шапка, основание формы под названием.
  for (const needle of ["СИСТЕМА ХАССП", "Периодичность контроля", "Начат", "Окончен", "ИНН", COLD_EQUIPMENT_LEGAL_BASIS]) {
    assert.ok(has(first, needle), `стр. 1: «${needle}»`);
  }
  rest.forEach((page, index) => {
    const n = index + 2;
    for (const needle of ["СИСТЕМА ХАССП", "Периодичность", "Начат", "Окончен", "ИНН", "Приложение № 2"]) {
      assert.ok(!has(page, needle), `стр. ${n}: лишнее «${needle}»`);
    }
    // Организация (короткое название), название журнала, номер страницы — вверху листа.
    const org = page.texts.find((t) => t.text.includes("Ромашка"));
    const label = page.texts.find((t) => t.text.trim() === `СТР. ${n} ИЗ ${pages.length}`);
    const title = page.texts.find((t) => t.text.includes("ЖУРНАЛ УЧЁТА ТЕМПЕРАТУРНОГО РЕЖИМА"));
    assert.ok(org && label && title, `стр. ${n}: организация, название, номер`);
    // Одна строка шапки: всё — на одной высоте (в пределах строки названия).
    assert.ok(Math.abs(label.baseline - org.baseline) < 0.5, `стр. ${n}: номер и организация на одной линии`);
  });

  const placements = rendered.qrPlacements ?? [];
  assert.equal(placements.length, pages.length);
  const tile = journalQrTile(input.qr!.url);
  const compact = journalQrCompact(input.qr!.url);
  assert.equal(placements[0].variant, "tile");
  for (const p of placements.slice(1)) {
    assert.equal(p.where, "header");
    assert.equal(p.variant, "compact");
    assert.ok(p.slot && p.box && p.window);
    // QR меньше: уже и ниже ячейки фирменной плитки, модуль — не мельче.
    assert.ok(compact.cellWidth < tile.cellWidth - 3, `ячейка ${compact.cellWidth} против ${tile.cellWidth}`);
    assert.ok(compact.modules < tile.modules);
    assert.equal(p.module, JOURNAL_QR_COMPACT_MODULE_MM);
    assert.ok(p.module >= 0.365 - 1e-9);
    // Шапка ниже, чем строки полной шапки (без строки периодичности).
    assert.ok(p.slot.y1 - p.slot.y0 < placements[0].slot!.y1 - placements[0].slot!.y0);
    // Правый край — у правого поля (вровень с таблицей), верх — на верхнем поле.
    assert.ok(Math.abs(p.slot.x1 - (pages[p.page - 1].widthMm - M)) < 0.01);
    assert.ok(Math.abs(p.slot.y0 - M) < 0.01);
    // Таблица — под шапкой через 3 мм: выше пусто, на 3 мм — линия таблицы.
    const page = pages[p.page - 1];
    const x = 150;
    for (let y = p.slot.y1 + 0.5; y < p.slot.y1 + 2.6; y += 0.2) {
      assert.ok(!page.ink(x, y), `стр. ${p.page}: зазор под шапкой пуст на ${(y - p.slot.y1).toFixed(1)} мм`);
    }
    assert.ok(
      [2.8, 3, 3.2].some((dy) => page.ink(x, p.slot!.y1 + dy)),
      `стр. ${p.page}: верх таблицы в 3 мм под шапкой`,
    );
  }
});

test("чек-лист уборки: на продолжениях — компактная шапка, таблица под ней не наезжает", async () => {
  const code = "cleaning_ventilation_checklist";
  const rendered = renderJournalDocumentPdf({ ...buildJournalSampleInput(code), qr: journalSamplePdfQr("https://wesetup.ru", code) });
  const pages = await inspect(rendered.buffer);
  assert.ok(pages.length >= 2);
  const placements = rendered.qrPlacements ?? [];
  assert.ok(has(pages[0], "СИСТЕМА ХАССП"));
  for (const p of placements.slice(1)) {
    const page = pages[p.page - 1];
    assert.equal(p.variant, "compact", `стр. ${p.page}`);
    assert.ok(!has(page, "СИСТЕМА ХАССП") && !has(page, "Начат"));
    // Первая строка таблицы (шапка столбцов «Дата») — ниже шапки листа.
    const firstRow = page.texts.filter((t) => t.x0 < 60 && t.top > p.slot!.y0).sort((a, b) => a.top - b.top)[1];
    assert.ok(firstRow && firstRow.top > p.slot!.y1, `стр. ${p.page}: таблица под шапкой (${firstRow?.text})`);
  }
});

test("гигиена: стр. 2 с пояснениями — компактная шапка, текст сразу под ней", async () => {
  const rendered = renderJournalDocumentPdf({
    ...buildJournalSampleInput("hygiene"),
    qr: journalSamplePdfQr("https://wesetup.ru", "hygiene"),
  });
  const pages = await inspect(rendered.buffer);
  assert.equal(pages.length, 2);
  assert.ok(has(pages[0], "Периодичность контроля"));
  assert.ok(!has(pages[1], "Периодичность") && !has(pages[1], "СИСТЕМА ХАССП"));
  const slot = rendered.qrPlacements![1].slot!;
  const notes = pages[1].texts.find((t) => t.text.startsWith("В журнал регистрируются результаты"));
  assert.ok(notes, "пояснения на стр. 2");
  const gap = notes.top - slot.y1;
  assert.ok(gap > 1.5 && gap < 5, `от шапки до текста ${gap.toFixed(2)} мм`);
});
