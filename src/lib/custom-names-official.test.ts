import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Печать (PDF), проверяющий, образцы на сайте и отчёты для надзорных
 * органов показывают ОФИЦИАЛЬНОЕ название журнала — так требуют проверки.
 * Свои названия организации туда попадать не должны: этот тест следит,
 * чтобы модули этих мест не начали читать `customNamesJson` и помощники
 * своих названий.
 */

const ROOT = process.cwd();

const OFFICIAL_ONLY = [
  // Печать
  "src/lib/document-pdf.ts",
  "src/lib/pdf.ts",
  "src/lib/paper-journal-pdf.ts",
  "src/lib/open-document-pdf.ts",
  "src/lib/journal-order-scans-pdf.ts",
  "src/lib/cleaning-ventilation-checklist-pdf.ts",
  "src/lib/sanitary-day-checklist-pdf.ts",
  "src/lib/qr-fill-poster.ts",
  "src/app/api/journal-documents/[id]/pdf",
  // Проверяющий
  "src/app/inspector",
  "src/app/inspector-sheet",
  "src/app/api/inspector",
  "src/lib/inspector-access.ts",
  "src/lib/inspector-doc-sheets.ts",
  "src/lib/inspector-journals.ts",
  "src/lib/inspector-page.ts",
  // Образцы на сайте
  "src/app/journals-info",
  "src/app/blanki",
  // Отчёты
  "src/app/api/reports",
  "src/lib/report-export.ts",
  "src/lib/report-export-data.ts",
];

const FORBIDDEN = [
  /["']@\/lib\/custom-names["']/,
  /["']@\/lib\/org-custom-names["']/,
  /custom-names-provider/,
  /customNamesJson/,
];

function sourceFiles(target: string): string[] {
  const full = path.join(ROOT, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.") ? [path.join(ROOT, child)] : [];
  });
}

test("печать, проверяющий, образцы и отчёты не берут свои названия организации", () => {
  const files = OFFICIAL_ONLY.flatMap(sourceFiles);
  assert.ok(files.length > 15, `ожидали найти модули печати и проверяющего, нашли ${files.length}`);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(text, pattern, `${path.relative(ROOT, file)}: ${pattern}`);
    }
  }
});
