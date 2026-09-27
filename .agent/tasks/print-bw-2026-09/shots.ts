/**
 * Скриншоты печатных бланков (растр PDF, pdf.js) до/после — без базы.
 *
 *   • hygiene-may      — гигиена за 1–14 мая 2026 (выходные 2–3, 9–10 мая,
 *                         праздники 1, 9, 11 мая, сокращённый 8 мая);
 *   • cleaning-may     — уборка за май с легендой дней под таблицей;
 *   • cold-deviations  — температура холодильников с отклонениями от нормы;
 *   • calibration      — график поверки с просроченной строкой;
 *   • checklist        — чек-лист уборки и проветривания;
 *   • paper            — бумажный бланк (инструктаж по ОТ);
 *   • docx-hygiene     — Word-шаблон гигиены с подвалом: DOCX → PDF в
 *                         LibreOffice (профиль и файлы — во временной папке).
 * Для каждого — цветной растр и «ч/б принтер»: яркость пикселя (как драйвер
 * ч/б принтера переводит цвет в серый). Файлы — в OUT/<метка>/.
 *
 * Запуск (из корня репо): npx tsx .agent/tasks/print-bw-2026-09/shots.ts <метка>
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { renderJournalDocumentPdf, type JournalDocumentPdfInput } from "@/lib/document-pdf";
import { renderJournalDocumentDocx } from "@/lib/document-docx";
import { journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { SAMPLE_ORGANIZATION, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderPaperJournalPdf } from "@/lib/paper-journal-pdf";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

import { openPdf, renderRegion, savePng, toGray, type BoxMm, type Raster } from "../journal-qr-header-2026-09/qr-sim";

const ORIGIN = "https://wesetup.ru";
const OUT = path.resolve(process.env.SHOTS_OUT ?? "D:/wt-build/tmp-bwprint/shots");
const SOFFICE = "C:/Program Files/LibreOffice/program/soffice.exe";
const DAY = 86_400_000;

/** Сдвиг образца на `days` дней вперёд: даты документа и записей. */
function shiftSample(code: string, days: number): JournalDocumentPdfInput {
  const input = buildJournalSampleInput(code);
  const doc = input.document as unknown as { dateFrom: Date; dateTo: Date; entries: Array<{ date: Date }> };
  return {
    ...input,
    document: {
      ...input.document,
      dateFrom: new Date(doc.dateFrom.getTime() + days * DAY),
      dateTo: new Date(doc.dateTo.getTime() + days * DAY),
      entries: doc.entries.map((e) => ({ ...e, date: new Date(e.date.getTime() + days * DAY) })),
    } as JournalDocumentPdfInput["document"],
    qr: journalSamplePdfQr(ORIGIN, code),
  };
}

function coldWithDeviations(): JournalDocumentPdfInput {
  const input = shiftSample("cold_equipment_control", 30);
  const config = input.document.config as unknown as { equipment: Array<{ id: string; min: number; max: number }> };
  const entries = (input.document as unknown as { entries: Array<{ data: { temperatures: Record<string, number> } }> }).entries;
  entries.forEach((entry, day) => {
    config.equipment.forEach((item, i) => {
      if ((day + i) % 4 === 0) entry.data = { ...entry.data, temperatures: { ...entry.data.temperatures, [item.id]: item.max + 3.5 } };
    });
  });
  return input;
}

function calibration(): JournalDocumentPdfInput {
  const input = buildJournalSampleInput("equipment_calibration");
  const config = { ...(input.document.config as Record<string, unknown>) };
  config.rows = [
    { id: "cal-overdue", equipmentName: "Термометр щуп", equipmentNumber: "ТЩ-1", location: "Горячий цех", purpose: "Температура", measurementRange: "−50…+300 °C", calibrationInterval: 12, lastCalibrationDate: "2024-03-10", note: "" },
    { id: "cal-ok", equipmentName: "Весы платформенные", equipmentNumber: "В-2", location: "Склад", purpose: "Масса", measurementRange: "0…150 кг", calibrationInterval: 12, lastCalibrationDate: "2026-06-01", note: "" },
    { id: "cal-ok2", equipmentName: "Гигрометр", equipmentNumber: "Г-3", location: "Склад сухих продуктов", purpose: "Влажность", measurementRange: "10…95 %", calibrationInterval: 24, lastCalibrationDate: "2025-11-20", note: "" },
  ];
  return { ...input, document: { ...input.document, config: config as typeof input.document.config }, qr: journalSamplePdfQr(ORIGIN, "equipment_calibration") };
}

type Shot = { name: string; build: () => Promise<Buffer> | Buffer; crop?: BoxMm; page?: number };

async function docxToPdf(docx: Buffer, name: string, dir: string): Promise<Buffer> {
  const work = path.join(dir, "lo");
  fs.mkdirSync(work, { recursive: true });
  const input = path.join(work, `${name}.docx`);
  fs.writeFileSync(input, docx);
  const profile = `file:///${path.join(OUT, "lo-profile").split(path.sep).join("/")}`;
  execFileSync(SOFFICE, [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", "pdf", "--outdir", work, input], { stdio: "ignore", timeout: 180000 });
  return fs.readFileSync(path.join(work, `${name}.pdf`));
}

async function rasterPdf(pdf: Buffer, page: number, crop: BoxMm | undefined, dpi: number): Promise<Raster> {
  const doc = await openPdf(pdf);
  try {
    const p = await doc.getPage(page);
    const vp = p.getViewport({ scale: 1 });
    const box = crop ?? { x0: 0, y0: 0, x1: (vp.width / 72) * 25.4, y1: (vp.height / 72) * 25.4 };
    return await renderRegion(doc, page, box, dpi);
  } finally {
    await doc.close();
  }
}

async function main() {
  const label = process.argv[2];
  if (!label) throw new Error("метка: before | after");
  const dir = path.join(OUT, label);
  fs.mkdirSync(dir, { recursive: true });
  const shots: Shot[] = [
    // Левая часть листа: шапка + первые две недели.
    { name: "hygiene-may", build: () => renderJournalDocumentPdf(shiftSample("hygiene", 30)).buffer, crop: { x0: 8, y0: 8, x1: 289, y1: 118 } },
    { name: "cleaning-may", build: () => renderJournalDocumentPdf(shiftSample("cleaning", 30)).buffer },
    { name: "cold-deviations", build: () => renderJournalDocumentPdf(coldWithDeviations()).buffer, crop: { x0: 8, y0: 8, x1: 289, y1: 150 } },
    { name: "calibration", build: () => renderJournalDocumentPdf(calibration()).buffer, crop: { x0: 8, y0: 88, x1: 289, y1: 148 } },
    { name: "checklist", build: () => renderJournalDocumentPdf({ ...buildJournalSampleInput("cleaning_ventilation_checklist"), qr: journalSamplePdfQr(ORIGIN, "cleaning_ventilation_checklist") }).buffer, crop: { x0: 8, y0: 8, x1: 289, y1: 150 } },
    { name: "sanitary-day", build: () => renderJournalDocumentPdf({ ...buildJournalSampleInput("sanitary_day_control"), qr: journalSamplePdfQr(ORIGIN, "sanitary_day_control") }).buffer, crop: { x0: 8, y0: 8, x1: 289, y1: 150 } },
    {
      name: "paper-ot_intro",
      build: () => renderPaperJournalPdf({ journal: PAPER_JOURNALS[0], organization: SAMPLE_ORGANIZATION, rows: [], blankRows: 8 }),
      crop: { x0: 8, y0: 6, x1: 289, y1: 110 },
    },
    {
      name: "docx-hygiene",
      build: async () =>
        docxToPdf(
          (
            await renderJournalDocumentDocx(buildJournalSampleInput("hygiene"), "hygiene", {
              footer: { qrUrl: `${ORIGIN}/qb/test-hygiene`, lines: ["Заполнять с телефона — wesetup.ru", "© WeSetup, 2026"] },
            })
          ).buffer,
          "docx-hygiene",
          dir,
        ),
    },
  ];
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  for (const shot of shots) {
    if (only && !only.has(shot.name)) continue;
    // RECROP=1 — растр из уже сохранённого PDF этой метки (другой кадр без перерисовки).
    const saved = path.join(dir, `${shot.name}.pdf`);
    const pdf = process.env.RECROP && fs.existsSync(saved) ? fs.readFileSync(saved) : Buffer.from(await shot.build());
    fs.writeFileSync(saved, pdf);
    const raster = await rasterPdf(pdf, shot.page ?? 1, shot.crop, 110);
    savePng(raster, path.join(dir, `${shot.name}.png`));
    savePng(toGray(raster), path.join(dir, `${shot.name}-bw.png`));
    console.log(`${shot.name}: ${raster.width}×${raster.height}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
