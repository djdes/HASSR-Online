/**
 * Образец журнала на КНИЖНОМ листе — только для проверки (скриншот, растр,
 * наложения): все бланки каталога печатаются альбомными, а спека просит
 * проверить шапку с QR и длинным названием на книжном листе.
 *
 * `renderJournalDocumentPdf` создаёт лист `new jsPDF({ orientation:
 * "landscape" })`; здесь на время одного рендера конструктор подменяется
 * на книжный (модуль jspdf у проекта общий — CommonJS, и document-pdf берёт
 * `jsPDF` из него при каждом вызове). Код продукта не меняется.
 */
import { createRequire } from "node:module";

import { renderJournalDocumentPdf, type RenderedJournalDocumentPdf } from "@/lib/document-pdf";
import { journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import type { JournalPdfQr } from "@/lib/pdf-journal-qr";

const requireCjs = createRequire(__filename);

export function renderPortraitSample(code: string, qr?: JournalPdfQr | null): RenderedJournalDocumentPdf {
  const jspdf = requireCjs("jspdf") as { jsPDF: new (options?: Record<string, unknown>) => unknown };
  const Original = jspdf.jsPDF;
  function Portrait(options?: Record<string, unknown>) {
    return new Original({ ...(options ?? {}), orientation: "portrait" });
  }
  Portrait.prototype = Original.prototype;
  Object.assign(Portrait, Original);
  jspdf.jsPDF = Portrait as unknown as typeof Original;
  try {
    return renderJournalDocumentPdf({
      ...buildJournalSampleInput(code),
      qr: qr === undefined ? journalSamplePdfQr("https://wesetup.ru", code) : qr,
    });
  } finally {
    jspdf.jsPDF = Original;
  }
}
