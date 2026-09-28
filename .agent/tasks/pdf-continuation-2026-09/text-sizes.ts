/**
 * Кегли, которыми бланки печатают текст (pdf.js: размер из матрицы строки),
 * — для проверки «самый мелкий текст до/после смены шрифта». Слово
 * «Отсканировать» в полосе фирменного QR не считается (часть плитки).
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/text-sizes.ts <метка> [набор,набор]
 * Итог — raw/text-sizes-<метка>.json: по каждому бланку — самый мелкий кегль и
 * пример строки, по всем — сколько строк каждого кегля.
 */
import fs from "node:fs";
import path from "node:path";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { openPdf } from "../journal-qr-header-2026-09/qr-sim";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-continuation-2026-09");

async function main() {
  const [label, setsArg] = process.argv.slice(2);
  const sets = new Set((setsArg ?? "samples,long,paper").split(","));
  const histogram = new Map<number, number>();
  const perCase: Array<{ set: string; label: string; min: number; sample: string; below65: number; items: number }> = [];
  for (const item of buildCases(sets)) {
    const rendered = item.render("stamp");
    const doc = await openPdf(rendered.buffer);
    let min = Infinity;
    let sample = "";
    let below = 0;
    let items = 0;
    for (let n = 1; n <= doc.numPages; n += 1) {
      const text = await (await doc.getPage(n)).getTextContent();
      for (const t of text.items as Array<{ str?: string; transform?: number[] }>) {
        const str = (t.str ?? "").trim();
        if (!str || str === "Отсканировать" || !t.transform) continue;
        const size = Math.round(Math.hypot(t.transform[2], t.transform[3]) * 10) / 10;
        items += 1;
        histogram.set(size, (histogram.get(size) ?? 0) + 1);
        if (size < 6.5) below += 1;
        if (size < min) {
          min = size;
          sample = str.slice(0, 60);
        }
      }
    }
    await doc.close();
    perCase.push({ set: item.set, label: item.label, min, sample, below65: below, items });
    console.log(`${item.set.padEnd(8)} ${item.label.padEnd(34)} min ${min} pt «${sample}» (<6,5 pt: ${below} из ${items})`);
  }
  const hist = [...histogram.entries()].sort((a, b) => a[0] - b[0]);
  console.log("\nкегль → строк:", hist.map(([s, c]) => `${s}:${c}`).join(" "));
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  fs.writeFileSync(path.join(TASK_DIR, "raw", `text-sizes-${label}.json`), JSON.stringify({ histogram: hist, perCase }, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
