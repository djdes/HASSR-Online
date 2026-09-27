import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { BRAND_QR_CAPTION_TITLE } from "@/lib/brand-qr";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import {
  ORDER_SCAN_ERRORS,
  ORDER_SCAN_MAX_BYTES,
  defaultOrderScanTitle,
  normalizeOrderScanTitle,
  orderScanAccessible,
  sniffOrderScanType,
  supportsOrderScans,
} from "@/lib/journal-order-scans";
import { appendOrderScansToPdf, validateOrderScanFile } from "@/lib/journal-order-scans-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";

/**
 * Сканы приказов к журналу (пожелание РПН, 2026-09-24): гигиена и БЖГП,
 * PDF / JPG / PNG до 10 МБ; в печати — после страниц журнала, без QR.
 */

async function scanPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(`ORDER SCAN PAGE ${i + 1}`, { x: 60, y: 760, size: 18, font });
  }
  return pdf.save();
}

function image(width: number, height: number, mime: "image/png" | "image/jpeg"): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eef1ff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#0b1024";
  ctx.fillRect(10, 10, width / 2, height / 3);
  return new Uint8Array(mime === "image/png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg"));
}

async function pageTexts(pdf: Uint8Array): Promise<string[]> {
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
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

test("приказы — только у гигиены и БЖГП; скоропорт и прочие без изменений", () => {
  assert.equal(supportsOrderScans("hygiene"), true);
  assert.equal(supportsOrderScans("finished_product"), true);
  assert.equal(supportsOrderScans("perishable_rejection"), false);
  assert.equal(supportsOrderScans("health_check"), false);
  assert.equal(supportsOrderScans("toString"), false);
  assert.equal(supportsOrderScans(null), false);
});

test("тип файла — по содержимому; HEIC — понятный отказ", async () => {
  assert.deepEqual(sniffOrderScanType(await scanPdf(1)), { ok: true, mime: "application/pdf" });
  assert.deepEqual(sniffOrderScanType(image(20, 10, "image/jpeg")), { ok: true, mime: "image/jpeg" });
  assert.deepEqual(sniffOrderScanType(image(20, 10, "image/png")), { ok: true, mime: "image/png" });
  const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
  assert.deepEqual(sniffOrderScanType(heic), { ok: false, error: ORDER_SCAN_ERRORS.heic });
  assert.deepEqual(sniffOrderScanType(new Uint8Array([1, 2, 3]), "IMG_0001.HEIC"), { ok: false, error: ORDER_SCAN_ERRORS.heic });
  assert.deepEqual(sniffOrderScanType(Buffer.from("<?php echo 1; ?>"), "x.pdf", "application/pdf"), {
    ok: false,
    error: ORDER_SCAN_ERRORS.type,
  });
  assert.deepEqual(sniffOrderScanType(new Uint8Array()), { ok: false, error: ORDER_SCAN_ERRORS.empty });
});

test("название: по умолчанию — имя файла, переименование — не пустое, до 200 символов", () => {
  assert.equal(defaultOrderScanTitle("Приказ_№12 о бракеражной комиссии.pdf"), "Приказ №12 о бракеражной комиссии");
  assert.equal(defaultOrderScanTitle(".pdf"), "Приказ");
  assert.equal(normalizeOrderScanTitle("  Приказ   №5 "), "Приказ №5");
  assert.equal(normalizeOrderScanTitle("   "), null);
  assert.equal(normalizeOrderScanTitle(42), null);
  assert.equal(normalizeOrderScanTitle("я".repeat(300))?.length, 200);
});

test("проверка загрузки: PDF и картинки открываются, битые и большие — отказ", async () => {
  const pdf = await validateOrderScanFile({ bytes: await scanPdf(2), fileName: "a.pdf", declaredMime: "application/pdf" });
  assert.deepEqual(pdf, { ok: true, mime: "application/pdf", pages: 2 });
  const png = await validateOrderScanFile({ bytes: image(40, 30, "image/png"), fileName: "a.png", declaredMime: "image/png" });
  assert.deepEqual(png, { ok: true, mime: "image/png", pages: 1 });
  const broken = await validateOrderScanFile({ bytes: Buffer.from("%PDF-1.7\nмусор"), fileName: "b.pdf", declaredMime: "" });
  assert.deepEqual(broken, { ok: false, error: ORDER_SCAN_ERRORS.pdf });
  const brokenJpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.deepEqual(await validateOrderScanFile({ bytes: brokenJpg, fileName: "c.jpg", declaredMime: "" }), {
    ok: false,
    error: ORDER_SCAN_ERRORS.image,
  });
  const big = new Uint8Array(ORDER_SCAN_MAX_BYTES + 1);
  assert.deepEqual(await validateOrderScanFile({ bytes: big, fileName: "d.pdf", declaredMime: "" }), {
    ok: false,
    error: ORDER_SCAN_ERRORS.tooBig,
  });
});

test("печать: после журнала — страницы PDF-скана и картинки на A4, без QR-штампа", async () => {
  const input = buildJournalSampleInput("hygiene");
  const journal = renderJournalDocumentPdf({ ...input, qr: journalSamplePdfQr("https://wesetup.ru", "hygiene") });
  const journalPages = (await PDFDocument.load(journal.buffer)).getPageCount();

  const merged = await appendOrderScansToPdf(new Uint8Array(journal.buffer), [
    { id: "1", title: "Приказ PDF", mimeType: "application/pdf", content: await scanPdf(2) },
    { id: "2", title: "Скан фото", mimeType: "image/jpeg", content: image(1200, 800, "image/jpeg") },
    { id: "3", title: "Скан PNG", mimeType: "image/png", content: image(600, 900, "image/png") },
    { id: "4", title: "Битый", mimeType: "application/pdf", content: Buffer.from("%PDF-мусор") },
  ]);
  assert.equal(merged.appendedPages, 4);
  assert.deepEqual(merged.skipped, ["Битый"]);

  const out = await PDFDocument.load(merged.buffer);
  assert.equal(out.getPageCount(), journalPages + 4);
  const pages = out.getPages();
  // Картинки — A4: широкая — альбомная, высокая — книжная.
  const landscape = pages[journalPages + 2].getSize();
  assert.deepEqual([Math.round(landscape.width), Math.round(landscape.height)], [842, 595]);
  const portrait = pages[journalPages + 3].getSize();
  assert.deepEqual([Math.round(portrait.width), Math.round(portrait.height)], [595, 842]);

  const texts = await pageTexts(new Uint8Array(merged.buffer));
  // QR в шапке — с полосой «Отсканировать»: по ней видно, где QR есть.
  const qrCaption = BRAND_QR_CAPTION_TITLE;
  assert.ok(texts.slice(0, journalPages).every((text) => text.includes(qrCaption)), "QR есть на каждой странице журнала");
  assert.ok(texts.slice(journalPages).every((text) => !text.includes(qrCaption)), "на страницах приказов QR нет");
  assert.match(texts[journalPages], /ORDER SCAN PAGE 1/);
  assert.match(texts[journalPages + 1], /ORDER SCAN PAGE 2/);
});

test("печать без приказов — журнал как был", async () => {
  const journal = renderJournalDocumentPdf(buildJournalSampleInput("finished_product"));
  const merged = await appendOrderScansToPdf(new Uint8Array(journal.buffer), []);
  assert.equal(merged.appendedPages, 0);
  assert.deepEqual(new Uint8Array(merged.buffer), new Uint8Array(journal.buffer));
});

test("доступ к файлу: только своя организация, журнал доступен и включён", () => {
  const scan = { organizationId: "org-a", journalCode: "hygiene" };
  assert.equal(orderScanAccessible({ scan, organizationId: "org-a", journalReadable: true }), true);
  // Чужая организация (сессия или токен проверяющего другой организации).
  assert.equal(orderScanAccessible({ scan, organizationId: "org-b", journalReadable: true }), false);
  // Без сессии / токена.
  assert.equal(orderScanAccessible({ scan, organizationId: null, journalReadable: true }), false);
  // Журнал сотруднику не выдан.
  assert.equal(orderScanAccessible({ scan, organizationId: "org-a", journalReadable: false }), false);
  // Журнал отключён у организации — проверяющий его не видит.
  assert.equal(
    orderScanAccessible({ scan, organizationId: "org-a", journalReadable: true, disabledCodes: new Set(["hygiene"]) }),
    false
  );
  // Нет файла или журнал без приказов.
  assert.equal(orderScanAccessible({ scan: null, organizationId: "org-a", journalReadable: true }), false);
  assert.equal(
    orderScanAccessible({ scan: { organizationId: "org-a", journalCode: "perishable_rejection" }, organizationId: "org-a", journalReadable: true }),
    false
  );
});
