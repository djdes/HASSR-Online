/**
 * Снимок печатных бланков «до / после» (AC3: шапка не выросла, страниц не больше).
 *
 * По всем наборам `journal-qr-header-2026-09/pages.ts` (samples, blanks, long,
 * paper, variants, portrait) — число страниц, модуль QR и по каждой странице:
 * где QR (шапка / угол / нет), ячейка шапки (ширина × высота = строки
 * организации и названия), плитка.
 *
 *   node --import tsx .agent/tasks/qr-bw-minimal-2026-09/baseline.ts <метка> [набор,набор]
 * Итог — raw/baseline-<метка>.json (метка: master | after).
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import { buildCases, countPdfPages } from "../journal-qr-header-2026-09/pages";

type Box = { x0: number; y0: number; x1: number; y1: number } | null;
type Placement = { page: number; where: string; box: Box; slot: Box; modules: number; module: number };

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-bw-minimal-2026-09");
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const size = (b: Box) => (b ? { w: r3(b.x1 - b.x0), h: r3(b.y1 - b.y0), x1: r3(b.x1), y0: r3(b.y0) } : null);

async function main() {
  const [label, setsArg] = process.argv.slice(2);
  if (!label) throw new Error("метка: master | after");
  const sets = new Set(setsArg ? setsArg.split(",") : ["samples", "blanks", "long", "paper", "variants", "portrait"]);
  const out: unknown[] = [];
  for (const item of buildCases(sets)) {
    const started = Date.now();
    const rendered = item.render("stamp");
    const placements = (rendered.qrPlacements ?? []) as Placement[];
    out.push({
      set: item.set,
      label: item.label,
      url: item.url,
      pages: countPdfPages(rendered.buffer),
      bytes: rendered.buffer.length,
      modules: placements[0]?.modules ?? null,
      module: placements[0] ? r3(placements[0].module * 10) / 10 : null,
      placements: placements.map((p) => ({ page: p.page, where: p.where, slot: size(p.slot), box: size(p.box) })),
    });
    const header = placements.filter((p) => p.where === "header");
    const cell = header[0]?.slot ? size(header[0].slot) : null;
    console.log(
      `${item.set.padEnd(9)} ${item.label.padEnd(36)} ${String(countPdfPages(rendered.buffer)).padStart(4)} стр. ` +
        `n=${placements[0]?.modules ?? "-"} m=${placements[0]?.module.toFixed(4) ?? "-"} ` +
        `шапка ${header.length} ячейка ${cell ? `${cell.w}×${cell.h}` : "-"} ${Date.now() - started} мс`,
    );
  }
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  const file = path.join(TASK_DIR, "raw", `baseline-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`итого: ${out.length} PDF → ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
