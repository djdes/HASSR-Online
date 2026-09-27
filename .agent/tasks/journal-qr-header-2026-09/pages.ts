/**
 * Число страниц печатных бланков — одним и тем же входом на коде master и на
 * коде ветки (AC2: «страниц нигде не больше, у длинных — меньше»).
 *
 * Наборы (все с QR, как их отдаёт сайт):
 *   • samples   — образцы 45 журналов каталога с QR образца (`journalSamplePdfQr`);
 *   • blanks    — те же образцы, скачанные после email (`blankPdfQr` с почтой);
 *   • long      — «длинные» документы всех 45 журналов (`long-inputs.ts`: строки
 *                 до 70, гигиена/здоровье 45 сотрудников) с QR документа
 *                 (`journalDocumentPdfQr`, короткий /qj/…);
 *   • paper     — 5 бумажных бланков (`renderPaperJournalPdfDetailed`, QR /qb);
 *   • variants  — гигиена по форме Приложения №1 и все образцы с подвалом партнёра.
 *
 * Запуск (из корня репо): npx tsx .agent/tasks/journal-qr-header-2026-09/pages.ts <метка> [набор,набор]
 * Итог — raw/pages-<метка>.json.
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import { blankPdfQr } from "@/lib/blank-qr-token";
import { renderJournalDocumentPdf, type JournalDocumentPdfInput } from "@/lib/document-pdf";
import { HYGIENE_FORM_VERSION_KEY } from "@/lib/hygiene-v2";
import { journalDocumentPdfQr, journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import type { JournalPdfQr } from "@/lib/pdf-journal-qr";
import { SAMPLE_JOURNAL_CODES, SAMPLE_ORGANIZATION, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderPaperJournalPdfDetailed } from "@/lib/paper-journal-pdf";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

import { buildLongJournalInput } from "./long-inputs";
import { renderPortraitSample } from "./portrait-inputs";

const ORIGIN = "https://wesetup.ru";
/** cuid организации — той же длины, что настоящие (25 символов). */
export const LONG_ORG_ID = "cmg7k2x9d0000qz8r4tv1abcd";
/**
 * Самая длинная почта, что помещается в QR шапки (32 байта; на master в
 * угловой QR помещалось 39): самый плотный код шаблона — 53 модуля.
 */
export const BLANK_EMAIL = "zaveduyushchaya@kombinat-pita.ru";
export const PARTNER = {
  brandName: "Партнёр Тест",
  pdfSignature:
    "Сопровождение и настройка журналов: ООО «Очень Длинное Название Партнёра по Внедрению ХАССП», тел. +7 900 000-00-00",
};
const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "journal-qr-header-2026-09");

/** stamp — как отдаёт сайт; probe — место под QR посчитано, но QR не нарисован; plain — без QR. */
export type RenderMode = "stamp" | "probe" | "plain";

export type PdfCase = {
  set: string;
  label: string;
  code: string;
  /** Адрес QR этого бланка. */
  url: string;
  render: (mode?: RenderMode) => { buffer: Buffer; qrPlacements?: unknown[] };
};

function qrFor(qr: JournalPdfQr, mode: RenderMode): JournalPdfQr | null {
  if (mode === "plain") return null;
  return mode === "probe" ? { ...qr, probeOnly: true } : qr;
}

export function buildCases(sets: Set<string> | null): PdfCase[] {
  const want = (set: string) => !sets || sets.has(set);
  const cases: PdfCase[] = [];
  const doc = (set: string, label: string, code: string, input: () => JournalDocumentPdfInput) => {
    const qr = input().qr as JournalPdfQr;
    cases.push({
      set,
      label,
      code,
      url: qr.url,
      render: (mode = "stamp") => renderJournalDocumentPdf({ ...input(), qr: qrFor(qr, mode) }),
    });
  };
  if (want("samples")) {
    for (const code of SAMPLE_JOURNAL_CODES) {
      doc("samples", code, code, () => ({ ...buildJournalSampleInput(code), qr: journalSamplePdfQr(ORIGIN, code) }));
    }
  }
  if (want("blanks")) {
    for (const code of SAMPLE_JOURNAL_CODES) {
      doc("blanks", code, code, () => ({
        ...buildJournalSampleInput(code),
        qr: blankPdfQr(ORIGIN, { target: { kind: "code", code }, email: BLANK_EMAIL }),
      }));
    }
  }
  if (want("long")) {
    for (const code of SAMPLE_JOURNAL_CODES) {
      doc("long", code, code, () => ({ ...buildLongJournalInput(code), qr: journalDocumentPdfQr(ORIGIN, LONG_ORG_ID, code) }));
    }
  }
  if (want("paper")) {
    for (const journal of PAPER_JOURNALS) {
      const qr = blankPdfQr(ORIGIN, { target: { kind: "paper", paperId: journal.id }, email: BLANK_EMAIL });
      cases.push({
        set: "paper",
        label: journal.id,
        code: journal.id,
        url: qr.url,
        render: (mode = "stamp") =>
          renderPaperJournalPdfDetailed({
            journal,
            organization: SAMPLE_ORGANIZATION,
            rows: [],
            blankRows: 18,
            qr: qrFor(qr, mode),
          }),
      });
    }
  }
  if (want("portrait")) {
    // Книжный лист (в продукте бланков на нём нет — проверка шапки с QR и
    // длинных названий, см. portrait-inputs.ts). В сравнение страниц с
    // master не входит.
    for (const code of SAMPLE_JOURNAL_CODES) {
      const qr = journalSamplePdfQr(ORIGIN, code);
      cases.push({ set: "portrait", label: code, code, url: qr.url, render: (mode = "stamp") => renderPortraitSample(code, qrFor(qr, mode)) });
    }
  }
  if (want("variants")) {
    doc("variants", "hygiene-v2", "hygiene", () => {
      const sample = buildJournalSampleInput("hygiene");
      const config = { ...(sample.document.config as Record<string, unknown>), [HYGIENE_FORM_VERSION_KEY]: 2 };
      return {
        ...sample,
        document: { ...sample.document, config: config as typeof sample.document.config },
        qr: journalSamplePdfQr(ORIGIN, "hygiene"),
      };
    });
    for (const code of SAMPLE_JOURNAL_CODES) {
      doc("variants", `partner-${code}`, code, () => ({
        ...buildJournalSampleInput(code),
        qr: journalSamplePdfQr(ORIGIN, code),
        branding: PARTNER,
      }));
    }
  }
  return cases;
}

/** Число страниц PDF jsPDF: объекты `/Type /Page` (без `/Pages`). */
export function countPdfPages(buffer: Buffer): number {
  return (buffer.toString("latin1").match(/\/Type \/Page(?![s\w])/g) ?? []).length;
}

async function main() {
  const [label, setsArg] = process.argv.slice(2);
  if (!label) throw new Error("метка: master | after");
  const sets = new Set(setsArg ? setsArg.split(",") : ["samples", "blanks", "long", "paper", "variants"]);
  const out: Array<{ set: string; label: string; code: string; pages: number; bytes: number; ms: number }> = [];
  for (const item of buildCases(sets)) {
    const started = Date.now();
    const rendered = item.render();
    const pages = countPdfPages(rendered.buffer);
    const ms = Date.now() - started;
    out.push({ set: item.set, label: item.label, code: item.code, pages, bytes: rendered.buffer.length, ms });
    console.log(`${item.set.padEnd(9)} ${item.label.padEnd(40)} ${String(pages).padStart(4)} стр. ${ms} мс`);
  }
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  fs.writeFileSync(path.join(TASK_DIR, "raw", `pages-${label}.json`), JSON.stringify(out, null, 1));
  console.log(`итого: ${out.length} PDF, ${out.reduce((s, r) => s + r.pages, 0)} страниц`);
}

if (process.argv[1] && /pages\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
