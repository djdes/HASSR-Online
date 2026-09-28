/**
 * Число страниц печатных бланков — одни и те же входы на коде master и на коде
 * ветки (AC3: «страниц нигде не больше, чем на master»).
 *
 * Наборы — из `journal-qr-header-2026-09/pages.ts` (там же описание):
 * samples (образцы 45 журналов с QR образца), blanks (те же образцы как
 * скачанный шаблон /qb), long («длинные» документы всех 45 журналов, QR /qj),
 * paper (5 бумажных бланков), variants (гигиена по Приложению №1 и образцы с
 * подвалом партнёра).
 *
 * Запуск (из корня репо):
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/page-counts.ts <метка> [набор,набор]
 * Итог — raw/pages-<метка>.json (+ время рендера каждого PDF).
 */
import fs from "node:fs";
import path from "node:path";

import { buildCases, countPdfPages } from "../journal-qr-header-2026-09/pages";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-continuation-2026-09");

async function main() {
  const [label, setsArg] = process.argv.slice(2);
  if (!label) throw new Error("метка: master | branch | …");
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
