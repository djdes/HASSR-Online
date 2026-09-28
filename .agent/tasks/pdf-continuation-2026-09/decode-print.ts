/**
 * QR печатного набора (`print/*.pdf`): на каждой странице с QR — jsQR и
 * zxing-cpp при 300 dpi (чистый снимок и «телефон») и 150 dpi (zxing-cpp);
 * адрес должен совпасть с заданным в `print-inputs.ts`.
 *
 *   QR_VERIFY_DIR=D:/wt-build/verify-pdfcont node --import tsx .agent/tasks/pdf-continuation-2026-09/decode-print.ts
 */
import fs from "node:fs";
import path from "node:path";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { PHONE, decodeJsQr, decodeZxing, openPdf, pageSizeMm, shotsOf } from "../journal-qr-header-2026-09/qr-sim";
import { PRINT_ITEMS } from "./print-inputs";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-continuation-2026-09");

async function main() {
  const rows: Array<Record<string, unknown>> = [];
  let bad = 0;
  for (const item of PRINT_ITEMS) {
    const input = item.build();
    const url = input.qr!.url;
    const rendered = renderJournalDocumentPdf(input);
    // Печатный PDF в print/ — тот же рендер (проверяем, что файл совпадает по страницам).
    const doc = await openPdf(rendered.buffer);
    for (const p of (rendered.qrPlacements ?? []) as JournalQrPlacement[]) {
      if (!p.box) continue;
      const size = await pageSizeMm(doc, p.page);
      const box = { x0: Math.max(0, p.box.x0 - 14), y0: Math.max(0, p.box.y0 - 8), x1: Math.min(size.width, p.box.x1 + 8), y1: p.box.y1 + 8 };
      const shots = await shotsOf(doc, p.page, box, [150, 300], { phone: { ...PHONE, angle: 7 } });
      const marks: string[] = [];
      for (const shot of shots) {
        const jsqr = decodeJsQr(shot.raster) === url;
        const zxing = (await decodeZxing(shot.raster)) === url;
        const need = shot.dpi === 300 ? jsqr && zxing : zxing;
        if (!need) bad += 1;
        marks.push(`${shot.dpi}${shot.kind}:${jsqr ? "J" : "-"}${zxing ? "Z" : "-"}`);
        rows.push({ file: item.file, page: p.page, variant: p.variant, dpi: shot.dpi, kind: shot.kind, jsqr, zxing });
      }
      console.log(`${item.file} стр. ${p.page} (${p.variant}, ${p.modules} мод. × ${p.module.toFixed(3)} мм) ${marks.join(" ")}`);
    }
    await doc.close();
  }
  fs.writeFileSync(path.join(TASK_DIR, "raw", "decode-print.json"), JSON.stringify(rows, null, 1));
  console.log(bad ? `не прочитано: ${bad}` : "все QR печатного набора читаются");
  process.exit(bad ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
