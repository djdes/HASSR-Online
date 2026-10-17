import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import {
  ORDER_SCAN_ERRORS,
  ORDER_SCAN_MAX_IMAGE_PIXELS,
  orderScanImageSize,
  orderScanImageWithinLimits,
  sniffOrderScanType,
} from "@/lib/journal-order-scans";
import { validateOrderScanFile } from "@/lib/journal-order-scans-pdf";
import { checkPdfIsolated } from "@/lib/pdf-isolated-check";

/**
 * Ревью безопасности (находка HIGH): общий валидатор сканов — у журнала
 * посещений по токену без входа и у приказов к журналам — не должен
 * распаковывать «бомбы» в основном процессе.
 */

/** Только заголовок PNG: сигнатура + IHDR с нужными сторонами, данных нет. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

/** JPEG: SOI, APP0 (сегмент с длиной), SOF0 с нужными сторонами. */
function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0xff, 0xd9,
  ]);
}

function realImage(width: number, height: number, mime: "image/png" | "image/jpeg"): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#357";
  ctx.fillRect(0, 0, width, height);
  return new Uint8Array(mime === "image/png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg"));
}

/** PDF, у которого поток объектов (/ObjStm) разжимается в `inflatedBytes`. */
function objStmBomb(inflatedBytes: number): Uint8Array {
  const packed = zlib.deflateSync(Buffer.alloc(inflatedBytes), { level: 9 });
  const head = Buffer.from(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n` +
      `3 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
    "latin1"
  );
  const tail = Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n", "latin1");
  return new Uint8Array(Buffer.concat([head, packed, tail]));
}

test("размер картинки читается из заголовка PNG (IHDR) и JPEG (SOF) до распаковки", () => {
  assert.deepEqual(orderScanImageSize(pngHeader(20_000, 20_000), "image/png"), { width: 20_000, height: 20_000 });
  assert.deepEqual(orderScanImageSize(jpegHeader(4000, 3000), "image/jpeg"), { width: 4000, height: 3000 });
  assert.deepEqual(orderScanImageSize(realImage(40, 30, "image/png"), "image/png"), { width: 40, height: 30 });
  assert.deepEqual(orderScanImageSize(realImage(64, 48, "image/jpeg"), "image/jpeg"), { width: 64, height: 48 });
  assert.equal(orderScanImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), "image/jpeg"), null);
  assert.equal(orderScanImageSize(pngHeader(0, 10), "image/png"), null);
});

test("пределы: сторона до 12000, всего до 40 Мп", () => {
  assert.equal(orderScanImageWithinLimits({ width: 4000, height: 3000 }), true);
  assert.equal(orderScanImageWithinLimits({ width: 12_001, height: 10 }), false);
  assert.equal(orderScanImageWithinLimits({ width: 7000, height: 7000 }), false, "49 Мп");
  assert.ok(ORDER_SCAN_MAX_IMAGE_PIXELS <= 40_000_000);
});

test("PNG-бомба 20000×20000 отклоняется по заголовку мгновенно, без распаковки", async () => {
  const started = Date.now();
  const result = await validateOrderScanFile({ bytes: pngHeader(20_000, 20_000), fileName: "bomb.png", declaredMime: "image/png" });
  assert.deepEqual(result, { ok: false, error: ORDER_SCAN_ERRORS.dimensions });
  assert.ok(Date.now() - started < 1000, "без декодирования");
  const jpeg = await validateOrderScanFile({ bytes: jpegHeader(15_000, 15_000), fileName: "big.jpg", declaredMime: "image/jpeg" });
  assert.deepEqual(jpeg, { ok: false, error: ORDER_SCAN_ERRORS.dimensions });
});

test("обычные PDF, PNG и JPEG по-прежнему проходят", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  const pdf = await validateOrderScanFile({ bytes: await doc.save(), fileName: "a.pdf", declaredMime: "application/pdf" });
  assert.deepEqual(pdf, { ok: true, mime: "application/pdf", pages: 2 });
  const png = await validateOrderScanFile({ bytes: realImage(40, 30, "image/png"), fileName: "a.png", declaredMime: "image/png" });
  assert.deepEqual(png, { ok: true, mime: "image/png", pages: 1 });
  const jpg = await validateOrderScanFile({ bytes: realImage(40, 30, "image/jpeg"), fileName: "a.jpg", declaredMime: "image/jpeg" });
  assert.deepEqual(jpg, { ok: true, mime: "image/jpeg", pages: 1 });
});

test("PDF-бомба: поток объектов сверх предела распаковки — «не удалось прочитать файл»", async () => {
  const bomb = objStmBomb(8 * 1024 * 1024);
  assert.ok(bomb.length < 64 * 1024, "сжатый файл маленький");
  assert.deepEqual(await checkPdfIsolated(bomb, { inflateBudgetBytes: 1024 * 1024 }), { status: "unreadable" });
  const result = await validateOrderScanFile(
    { bytes: bomb, fileName: "bomb.pdf", declaredMime: "application/pdf" },
    { pdfCheck: { inflateBudgetBytes: 1024 * 1024 } }
  );
  assert.deepEqual(result, { ok: false, error: ORDER_SCAN_ERRORS.unreadable });
  // Тот же файл в пределах бюджета доходит до pdf-lib: отказ дал именно предел распаковки.
  assert.notEqual((await checkPdfIsolated(bomb, { inflateBudgetBytes: 16 * 1024 * 1024 })).status, "unreadable");
  // Настройки по умолчанию (32 МБ): поток на 48 МБ отклоняется.
  assert.deepEqual(await checkPdfIsolated(objStmBomb(48 * 1024 * 1024)), { status: "unreadable" });
});

test("PDF: зависание обрывается по таймауту, битый файл — прежняя причина", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  assert.deepEqual(await checkPdfIsolated(await doc.save(), { timeoutMs: 1 }), { status: "unreadable" });
  const broken = await validateOrderScanFile({ bytes: Buffer.from("%PDF-1.7\nмусор"), fileName: "b.pdf", declaredMime: "" });
  assert.deepEqual(broken, { ok: false, error: ORDER_SCAN_ERRORS.pdf });
});

test("«%PDF-» — только в начале файла: HTML-префикс + валидный PDF — отказ", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const pdf = Buffer.from(await doc.save());
  assert.deepEqual(sniffOrderScanType(Buffer.concat([Buffer.from("<html>"), pdf])), { ok: false, error: ORDER_SCAN_ERRORS.type });
  assert.deepEqual(sniffOrderScanType(Buffer.concat([Buffer.from("<script>alert(1)</script>\n"), pdf])), {
    ok: false,
    error: ORDER_SCAN_ERRORS.type,
  });
  assert.deepEqual(sniffOrderScanType(Buffer.concat([Buffer.alloc(40, 0x20), pdf])), { ok: false, error: ORDER_SCAN_ERRORS.type }, "дальше 16 байт");
  assert.deepEqual(sniffOrderScanType(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), pdf])), { ok: true, mime: "application/pdf" });
  assert.deepEqual(sniffOrderScanType(Buffer.concat([Buffer.from("\r\n"), pdf])), { ok: true, mime: "application/pdf" });
  assert.deepEqual(sniffOrderScanType(pdf), { ok: true, mime: "application/pdf" });
});
