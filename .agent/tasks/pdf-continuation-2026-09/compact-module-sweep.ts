/**
 * Опыт: какой модуль нужен компактному QR продолжения (коррекция M, без знака
 * и полосы), чтобы он уверенно читался (приёмка спеки: 300 dpi — jsQR и
 * zxing-cpp 100 %, 150 dpi — zxing-cpp 100 %; чистый, ч/б, ч/б-принтер,
 * «телефон», ч/б + телефон; плюс «жёсткий телефон» — стресс).
 *
 * На листе A4 (альбомный) в правом верхнем углу — ячейка как у компактной
 * шапки: линии 0,2 мм вокруг окна кода (тихая зона 2 модуля), слева —
 * ячейка «СТР. 2 ИЗ 4», снизу — линия таблицы. Код рисуется так же, как в
 * продукте (`drawJournalCompactQrPdf`: строки модулей прямоугольниками).
 * Адреса — настоящие: документы /qj/ всех 45 журналов (37 и 41 модуль),
 * образцы /journals-info (29–37), самый плотный шаблон /qb (41).
 *
 *   QR_VERIFY_DIR=D:/wt-build/verify-pdfcont node --import tsx .agent/tasks/pdf-continuation-2026-09/compact-module-sweep.ts [модули через запятую]
 * Итог — raw/compact-module-sweep.json и таблица в консоли.
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import { jsPDF } from "jspdf";
import QRCode from "qrcode";

import { blankPdfQr } from "@/lib/blank-qr-token";
import { journalDocumentPdfQr, journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";

import { BLANK_EMAIL, LONG_ORG_ID } from "../journal-qr-header-2026-09/pages";
import { PHONE, PHONE_HARD, decodeJsQr, decodeZxing, openPdf, shotsOf, type ShotKind } from "../journal-qr-header-2026-09/qr-sim";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-continuation-2026-09");
const ORIGIN = "https://wesetup.ru";
const QUIET = 2;
const LINE = 0.2;

function renderCell(url: string, module: number): { pdf: Buffer; box: { x0: number; y0: number; x1: number; y1: number } } {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const font = registerJournalUnicodeFont(doc);
  const matrix = QRCode.create(url, { errorCorrectionLevel: "M" });
  const size = matrix.modules.size;
  const side = (size + 2 * QUIET) * module;
  const cellW = side + LINE;
  const x1 = 287;
  const y0 = 10;
  const qrLeft = x1 - cellW;
  const height = Math.max(10, cellW);
  // Шапка: рамка, «СТР.» слева от QR, линия таблицы ниже.
  doc.setLineWidth(LINE);
  doc.rect(200, y0, x1 - 200, height);
  doc.line(qrLeft, y0, qrLeft, y0 + height);
  doc.setFont(font, "bold");
  doc.setFontSize(10);
  doc.text("СТР. 2 ИЗ 4", (200 + qrLeft) / 2, y0 + height / 2 + 1.2, { align: "center" });
  doc.line(200, y0 + height + 3, x1, y0 + height + 3);
  // Код — как drawJournalCompactQrPdf.
  const half = LINE / 2;
  const box = { x0: qrLeft + half, y0: y0 + half, x1: x1 - half, y1: y0 + height - half };
  const cx0 = box.x0 + (box.x1 - box.x0 - side) / 2 + QUIET * module;
  const cy0 = box.y0 + (box.y1 - box.y0 - side) / 2 + QUIET * module;
  doc.setFillColor(0, 0, 0);
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!matrix.modules.get(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && matrix.modules.get(row, col)) col += 1;
      doc.rect(cx0 + start * module, cy0 + row * module, (col - start) * module, module + 0.01, "F");
    }
  }
  return { pdf: Buffer.from(doc.output("arraybuffer")), box };
}

type Row = { module: number; kind: string; url: string; modules: number; angle: number; dpi: number; shot: ShotKind; jsqr: boolean; zxing: boolean };

async function main() {
  const modulesArg = process.argv[2] ?? "0.3,0.33,0.35,0.365,0.38";
  const moduleSizes = modulesArg.split(",").map(Number);
  const urls: Array<{ kind: string; url: string }> = [];
  SAMPLE_JOURNAL_CODES.forEach((code, index) => {
    if (index % 3 === 0 || code === "cleaning_ventilation_checklist" || code === "incoming_raw_materials_control") {
      urls.push({ kind: "документ /qj", url: journalDocumentPdfQr(ORIGIN, LONG_ORG_ID, code).url });
    }
  });
  for (const code of ["hygiene", "cold_equipment_control", "climate_control", "incoming_raw_materials_control"]) {
    urls.push({ kind: "образец", url: journalSamplePdfQr(ORIGIN, code).url });
  }
  urls.push({ kind: "шаблон /qb", url: blankPdfQr(ORIGIN, { target: { kind: "code", code: "cold_equipment_control" }, email: BLANK_EMAIL }).url });

  const rows: Row[] = [];
  let index = 0;
  for (const module of moduleSizes) {
    for (const item of urls) {
      const angle = (5 + (index % 6)) * (index % 2 === 0 ? 1 : -1);
      index += 1;
      const { pdf, box } = renderCell(item.url, module);
      const doc = await openPdf(pdf);
      const frame = { x0: box.x0 - 14, y0: Math.max(0, box.y0 - 8), x1: Math.min(297, box.x1 + 8), y1: box.y1 + 8 };
      const shots = await shotsOf(doc, 1, frame, [150, 300], { phone: { ...PHONE, angle }, hard: { ...PHONE_HARD, angle } });
      const modules = QRCode.create(item.url, { errorCorrectionLevel: "M" }).modules.size;
      for (const shot of shots) {
        rows.push({
          module,
          kind: item.kind,
          url: item.url,
          modules,
          angle,
          dpi: shot.dpi,
          shot: shot.kind,
          jsqr: decodeJsQr(shot.raster) === item.url,
          zxing: (await decodeZxing(shot.raster)) === item.url,
        });
      }
      await doc.close();
    }
    const mine = rows.filter((r) => r.module === module);
    const cell = (dpi: number, shot: ShotKind, decoder: "jsqr" | "zxing") => {
      const list = mine.filter((r) => r.dpi === dpi && r.shot === shot);
      return `${list.filter((r) => r[decoder]).length}/${list.length}`;
    };
    const kinds: ShotKind[] = ["clean", "bw", "bw-print", "phone", "bw-phone", "phone-hard", "bw-phone-hard"];
    console.log(
      `модуль ${module} мм | 150 dpi zxing: ${kinds.map((k) => `${k} ${cell(150, k, "zxing")}`).join(", ")}\n` +
        `             | 150 dpi jsQR:  ${kinds.map((k) => `${k} ${cell(150, k, "jsqr")}`).join(", ")}\n` +
        `             | 300 dpi jsQR:  ${kinds.map((k) => `${k} ${cell(300, k, "jsqr")}`).join(", ")}\n` +
        `             | 300 dpi zxing: ${kinds.map((k) => `${k} ${cell(300, k, "zxing")}`).join(", ")}`,
    );
  }
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  fs.writeFileSync(path.join(TASK_DIR, "raw", "compact-module-sweep.json"), JSON.stringify(rows, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
