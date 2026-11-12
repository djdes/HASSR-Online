import fs from "node:fs";
import path from "node:path";

import type { jsPDF } from "jspdf";

import { drawPdfLogo, fitPdfLogo, type PdfLogo } from "@/lib/pdf-logo";

/**
 * Титульный лист журнала (2026-11-12) — первая страница PDF перед бланком,
 * по образцу журналов, которые прислал владелец (ИП Федотов, пищеблок):
 * организация и адрес сверху, «В соответствии с Приложением N … к СанПиН»
 * справа, крупное название по центру, внизу справа — ответственный за
 * ведение журнала и даты «Журнал начат / окончен». Вверху слева — логотип
 * организации (если загружен), справа — знак «сетап» и wesetup.ru.
 *
 * Только для журналов из списка ниже; у остальных PDF не меняется.
 */

export type JournalCover = {
  /** Строки крупного названия. */
  lines: string[];
  /** «Приложение N 1» к СанПиН 2.3/2.4.3590-20; нет — блок не печатается. */
  appendix?: string;
};

const SANPIN = "к СанПиН 2.3/2.4.3590-20";

export const JOURNAL_COVERS: Readonly<Record<string, JournalCover>> = {
  hygiene: { lines: ["ГИГИЕНИЧЕСКИЙ ЖУРНАЛ", "(сотрудники)"], appendix: "Приложение N 1" },
  cold_equipment_control: { lines: ["Журнал учета температурного режима", "холодильного оборудования"], appendix: "Приложение N 2" },
  climate_control: { lines: ["Журнал учета температуры и влажности", "в складских помещениях"], appendix: "Приложение N 3" },
  finished_product: { lines: ["Журнал бракеража", "готовой пищевой продукции"], appendix: "Приложение N 4" },
  perishable_rejection: { lines: ["Журнал бракеража", "скоропортящейся пищевой продукции"], appendix: "Приложение N 5" },
  staff_training: { lines: ["Журнал обучения/инструктажа", "программе безопасности пищевой продукции", "на основе принципов ХАССП"] },
  general_cleaning: { lines: ["Журнал проведения", "генеральных уборок"] },
  uv_lamp_runtime: { lines: ["Журнал регистрации и контроля работы", "ультрафиолетовой бактерицидной установки"] },
  equipment_maintenance: { lines: ["Журнал технического обслуживания", "и ремонта оборудования"] },
  disinfectant_usage: { lines: ["Журнал учета", "дезинфицирующих средств"] },
  pest_control: { lines: ["Журнал учета работ", "по дезинсекции и дератизации"] },
};

export function journalCover(templateCode: string): JournalCover | null {
  return JOURNAL_COVERS[templateCode] ?? null;
}

const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «"12" ноября 2026 г.»; нет даты — пустые строки для заполнения от руки. */
export function coverDate(date: Date | null): { day: string; year: string } {
  if (!date) return { day: "\"___\" __________", year: "20___ г." };
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return { day: `"${String(msk.getUTCDate()).padStart(2, "0")}" ${MONTHS_GENITIVE[msk.getUTCMonth()]}`, year: `${msk.getUTCFullYear()} г.` };
}

/** Знак «сетап» для титульника (PNG из кита фирменных документов). */
let setapMark: PdfLogo | null | undefined;
function setapLogo(): PdfLogo | null {
  if (setapMark !== undefined) return setapMark;
  try {
    const data = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brand-docs", "assets", "wordmark-polnoch.png"));
    setapMark = { data: new Uint8Array(data), width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  } catch {
    setapMark = null;
  }
  return setapMark;
}

export type JournalCoverParams = {
  cover: JournalCover;
  fontName: string;
  /** Название организации для журналов (с точкой, если есть). */
  organization: string;
  address: string | null;
  responsiblePost: string | null;
  responsibleName: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Логотип организации; нет — место пустое. */
  logo: PdfLogo | null;
};

/** Рисует титульный лист на текущей странице (A4 альбомная). */
export function drawJournalCover(doc: jsPDF, params: JournalCoverParams): void {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 18;
  const center = width / 2;
  doc.setTextColor(0, 0, 0);

  // Логотипы: организации — слева, «сетап» — справа с адресом сайта.
  if (params.logo) drawPdfLogo(doc, params.logo, { x: margin, y: margin - 6, maxW: 45, maxH: 18, align: "left" });
  const mark = setapLogo();
  if (mark) {
    // Свой alias: у drawPdfLogo он общий («org-logo»), и знак подменился бы логотипом организации.
    const drawn = fitPdfLogo(mark, 30, 7);
    doc.addImage(mark.data, "PNG", width - margin - drawn.w, margin - 5, drawn.w, drawn.h, "setap-mark", "FAST");
    doc.setFont(params.fontName, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 110);
    doc.text("Электронный журнал · wesetup.ru", width - margin, margin - 5 + drawn.h + 4, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }

  // Организация и адрес — сверху по центру.
  doc.setFont(params.fontName, "bold");
  doc.setFontSize(12);
  const orgLines = doc.splitTextToSize(params.organization, width - 2 * margin - 110) as string[];
  let y = margin + 4;
  for (const line of orgLines) {
    doc.text(line, center, y, { align: "center" });
    y += 6;
  }
  if (params.address) {
    doc.setFont(params.fontName, "normal");
    doc.setFontSize(11);
    for (const line of doc.splitTextToSize(params.address, width - 2 * margin - 110) as string[]) {
      doc.text(line, center, y, { align: "center" });
      y += 5.5;
    }
  }

  // «В соответствии с Приложением N … к СанПиН» — справа.
  const blockX = width - margin - 85;
  const blockCenter = blockX + 42.5;
  doc.setFont(params.fontName, "normal");
  doc.setFontSize(11);
  if (params.cover.appendix) {
    const top = Math.max(y + 6, 44);
    doc.text("В соответствии с", blockCenter, top, { align: "center" });
    doc.text(params.cover.appendix, blockCenter, top + 6, { align: "center" });
    doc.text(SANPIN, blockCenter, top + 12, { align: "center" });
  }

  // Крупное название — по центру листа.
  const titleSize = params.cover.lines.length > 2 ? 26 : 32;
  doc.setFont(params.fontName, "bold");
  doc.setFontSize(titleSize);
  const lineStep = titleSize * 0.3528 * 1.25;
  const titleLines = params.cover.lines.flatMap((line) => doc.splitTextToSize(line, width - 2 * margin - 10) as string[]);
  let ty = height * 0.46 - ((titleLines.length - 1) * lineStep) / 2;
  for (const line of titleLines) {
    doc.text(line, center, ty, { align: "center" });
    ty += lineStep;
  }

  // Ответственный и даты — внизу справа.
  doc.setFont(params.fontName, "normal");
  doc.setFontSize(11);
  // Подписи слева, значения — колонкой справа: длинная должность не наезжает на подпись.
  const labelX = width - margin - 185;
  let by = height - margin - 40;
  const signature = `${params.responsiblePost || "_______________"} / ${params.responsibleName || "________________"}`;
  doc.text("Ответственный за ведение журнала", labelX, by);
  doc.text(signature, blockCenter, by, { align: "center" });
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text("должность", blockCenter - 20, by + 4.5, { align: "center" });
  doc.text("ФИО", blockCenter + 20, by + 4.5, { align: "center" });
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  by += 15;
  for (const [label, date] of [
    ["Журнал начат", params.startedAt],
    ["Журнал окончен", params.finishedAt],
  ] as const) {
    const value = coverDate(date);
    doc.text(label, labelX, by);
    doc.text(`${value.day} ${value.year}`, blockCenter, by, { align: "center" });
    by += 10;
  }
}
