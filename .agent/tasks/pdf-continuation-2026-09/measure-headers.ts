/**
 * Размеры шапки по растру (300 dpi): высота полной шапки стр. 1 и компактной
 * шапки продолжения, зазор до следующего блока (таблицы), ячейка QR — у
 * длинных документов печатного набора и нескольких образцов.
 *
 * Высота шапки — непрерывная тёмная вертикаль левой рамки (x = поле листа)
 * от верхнего поля вниз; зазор — от её низа до следующей тёмной точки той же
 * вертикали (рамка таблицы).
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/measure-headers.ts
 * Итог — raw/header-sizes.json и таблица в консоли.
 */
import fs from "node:fs";
import path from "node:path";

import { renderJournalDocumentPdf, type JournalDocumentPdfInput } from "@/lib/document-pdf";
import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { openPdf, renderRegion } from "../journal-qr-header-2026-09/qr-sim";
import { PRINT_ITEMS } from "./print-inputs";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-continuation-2026-09");
const DPI = 300;

async function frameRuns(pdf: Buffer, page: number, xMm: number): Promise<Array<[number, number]>> {
  const doc = await openPdf(pdf);
  const r = await renderRegion(doc, page, { x0: xMm - 0.3, y0: 0, x1: xMm + 0.3, y1: 210 }, DPI);
  await doc.close();
  const k = DPI / 25.4;
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let y = 0; y < r.height; y += 1) {
    let dark = false;
    for (let x = 0; x < r.width; x += 1) {
      const i = (y * r.width + x) * 4;
      if (Math.min(r.data[i], r.data[i + 1], r.data[i + 2]) < 128) dark = true;
    }
    if (dark && start < 0) start = y;
    if (!dark && start >= 0) {
      runs.push([start / k, y / k]);
      start = -1;
    }
  }
  return runs;
}

async function main() {
  const rows: Array<Record<string, unknown>> = [];
  for (const item of PRINT_ITEMS) {
    const input: JournalDocumentPdfInput = item.build();
    const rendered = renderJournalDocumentPdf(input);
    const placements = (rendered.qrPlacements ?? []) as JournalQrPlacement[];
    for (const p of placements.slice(0, 2)) {
      if (p.where !== "header" || !p.slot) continue;
      // Левая рамка шапки — на поле листа (10 мм), линия 0,2 мм.
      const runs = await frameRuns(rendered.buffer, p.page, 10);
      const header = runs.find((run) => run[0] <= p.slot!.y0 + 0.5 && run[1] >= p.slot!.y1 - 0.5);
      const next = header ? runs.find((run) => run[0] > header[1] + 0.2) : undefined;
      const row = {
        file: item.file,
        page: p.page,
        variant: p.variant,
        headerTop: header ? +header[0].toFixed(2) : null,
        headerHeight: header ? +(header[1] - header[0]).toFixed(2) : null,
        gapToNext: header && next ? +(next[0] - header[1]).toFixed(2) : null,
        qrCellWidth: +(p.slot.x1 - p.slot.x0).toFixed(2),
        qrCellHeight: +(p.slot.y1 - p.slot.y0).toFixed(2),
        qrCode: p.window ? +(p.window.x1 - p.window.x0).toFixed(2) : null,
        modules: p.modules,
        module: +p.module.toFixed(4),
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  fs.writeFileSync(path.join(TASK_DIR, "raw", "header-sizes.json"), JSON.stringify(rows, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
