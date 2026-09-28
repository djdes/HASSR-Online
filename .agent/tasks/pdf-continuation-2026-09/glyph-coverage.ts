/**
 * Какие символы печатают бланки и есть ли они в шрифте журнала.
 *
 * Рендер всех наборов (как pages.ts) → текст pdf.js → множество символов →
 * сверка с cmap шрифтов (cmaps.json — выгрузка fontTools: Liberation Serif
 * Regular/Bold, DejaVu Sans / Bold). Плюс строковые литералы с не-ASCII
 * символами из исходников печати (то, что образцы могли не показать).
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/glyph-coverage.ts <cmaps.json> [наборы]
 */
import fs from "node:fs";
import path from "node:path";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { openPdf } from "../journal-qr-header-2026-09/qr-sim";

async function main() {
  const [cmapsFile, setsArg] = process.argv.slice(2);
  const cmaps = JSON.parse(fs.readFileSync(cmapsFile, "utf8")) as Record<string, number[]>;
  const serif = new Set(cmaps.serif);
  const serifBold = new Set(cmaps.serifBold);
  const sets = new Set((setsArg ?? "samples,long,paper,variants,blanks").split(","));
  const seen = new Map<number, Set<string>>();
  for (const item of buildCases(sets)) {
    const rendered = item.render("stamp");
    const doc = await openPdf(rendered.buffer);
    for (let n = 1; n <= doc.numPages; n += 1) {
      const text = await (await doc.getPage(n)).getTextContent();
      for (const t of text.items) {
        for (const ch of t.str ?? "") {
          const cp = ch.codePointAt(0)!;
          if (cp < 0x80 || (cp >= 0x400 && cp <= 0x4ff)) continue;
          const where = seen.get(cp) ?? new Set<string>();
          if (where.size < 4) where.add(`${item.set}:${item.label}`);
          seen.set(cp, where);
        }
      }
    }
    await doc.close();
  }
  // Литералы исходников печати.
  const sources = [
    "src/lib/document-pdf.ts",
    "src/lib/paper-journal-pdf.ts",
    "src/lib/cleaning-ventilation-checklist-pdf.ts",
    "src/lib/sanitary-day-checklist-pdf.ts",
    "src/lib/pdf-page-labels.ts",
    "src/lib/pdf-journal-qr.ts",
  ];
  const literal = new Map<number, string>();
  for (const file of sources) {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80 || (cp >= 0x400 && cp <= 0x4ff)) continue;
      if (!literal.has(cp)) literal.set(cp, file);
    }
  }
  const row = (cp: number) =>
    `U+${cp.toString(16).toUpperCase().padStart(4, "0")} «${String.fromCodePoint(cp)}» serif=${serif.has(cp) ? "да" : "НЕТ"} bold=${serifBold.has(cp) ? "да" : "НЕТ"}`;
  console.log("В напечатанном тексте (кроме ASCII и кириллицы):");
  for (const cp of [...seen.keys()].sort((a, b) => a - b)) console.log(`  ${row(cp)}  ${[...seen.get(cp)!].join(", ")}`);
  console.log("\nВ исходниках печати (включая комментарии):");
  for (const cp of [...literal.keys()].sort((a, b) => a - b)) {
    if (!serif.has(cp)) console.log(`  ${row(cp)}  ${literal.get(cp)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
