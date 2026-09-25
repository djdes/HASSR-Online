/* eslint-disable no-console */
/**
 * Таблицы для evidence.md из evidence.json, mini-compare.json,
 * tablet-compare.json и results-*-360.json (печатает markdown).
 *
 *   npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/tables.ts
 */
import fs from "node:fs";
import path from "node:path";

const DIR = __dirname;
const read = (file: string) => (fs.existsSync(path.join(DIR, file)) ? JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) : null);
const ev = JSON.parse(fs.readFileSync(path.join(DIR, "..", "evidence.json"), "utf8"));
const mini = read("mini-compare.json");
const tablet = read("tablet-compare.json");
const b360 = read("results-before-360.json");
const a360 = read("results-after-360.json");
const desktop = read("desktop-compare.json");
const layer = read("layer-check.json");

type Row = Record<string, Record<string, unknown> & { before?: unknown; after?: unknown }>;
const NAMES: Record<string, string> = {
  "01-dashboard": "Главная",
  "02-journals": "Журналы",
  "03-journal-doc": "Документ журнала (гигиена)",
  "04-settings": "Настройки",
  "05-staff": "Сотрудники",
  "06-qr-posters": "QR-коды",
  "07-orders": "Приказы",
  "08-master": "Мастер-кабинет",
};

console.log("### AC1 — шапка (390)\n");
console.log("| Страница | Шапка до, px | после, px | Кнопки шапки после (Ш×В) |");
console.log("|---|---|---|---|");
for (const [key, row] of Object.entries(ev.pages as Record<string, Row>)) {
  const r = row as unknown as { header390: { before: number; after: number }; headerIcons390After: string[] };
  console.log(`| ${NAMES[key]} | ${r.header390.before} | ${r.header390.after} | ${r.headerIcons390After.join(", ")} |`);
}

console.log("\n### AC2 — 390: кнопки/поля, зазоры, кегль, прокрутка\n");
console.log("| Страница | Кнопок и полей | < 48 px до → после | шрифт поля < 16 до → после | зазор < 8 px до → после (без плавающего дока) | кегль, медиана до → после | доля текста ≥ 15 px до → после | ≥ 16 px | ширина документа после | вылетов за край после | скриншоты |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const [key, row] of Object.entries(ev.pages as Record<string, Row>)) {
  const r = row as unknown as {
    controls390: { before: number; after: number };
    below48: { before: number; after: number };
    fieldFontBelow16: { before: number; after: number };
    tightPairsBelow8: { before: number; after: number };
    tightPairsExcludingFloatingDock: { before: number; after: number };
    textMedianPx: { before: number; after: number };
    textShareGe15: { before: number; after: number };
    textShareGe16: { before: number; after: number };
    overflow390After: { scrollWidth: number; offenders: number };
    shots: { before390: string; after390: string };
  };
  console.log(
    `| ${NAMES[key]} | ${r.controls390.after} | ${r.below48.before} → **${r.below48.after}** | ${r.fieldFontBelow16.before} → **${r.fieldFontBelow16.after}** | ${r.tightPairsExcludingFloatingDock.before} → **${r.tightPairsExcludingFloatingDock.after}** | ${r.textMedianPx.before} → **${r.textMedianPx.after}** | ${r.textShareGe15.before}% → **${r.textShareGe15.after}%** | ${r.textShareGe16.before}% → ${r.textShareGe16.after}% | ${r.overflow390After.scrollWidth} | ${r.overflow390After.offenders} | \`${r.shots.before390}\`, \`${r.shots.after390}\` |`
  );
}

if (b360 && a360) {
  console.log("\n### 360 px (узкий Android, DASHBOARD.md)\n");
  console.log("| Страница | < 48 px до → после | шрифт поля < 16 | ширина документа до → после | вылетов после |");
  console.log("|---|---|---|---|---|");
  for (const key of Object.keys(a360.pages)) {
    const b = b360.pages[key]?.["390"];
    const a = a360.pages[key]["390"];
    console.log(`| ${NAMES[key]} | ${b?.small.length} → **${a.small.length}** | ${a.smallFieldFont.length} | ${b?.overflow.scrollWidth} → ${a.overflow.scrollWidth} | ${a.overflow.offenders.length} |`);
  }
}

console.log("\n### AC3 — 1440\n");
console.log("| Страница | Элементов | Расхождений геометрии | Шапка до/после, px | Пиксели первого экрана (отличий / всего) | скриншоты |");
console.log("|---|---|---|---|---|---|");
for (const [key, row] of Object.entries(ev.pages as Record<string, Row>)) {
  const r = row as unknown as {
    header1440: { before: number; after: number };
    desktop1440: { elements: number; geometryDiffs: number; pixels: { diff: number; total: number } };
    shots: { before1440: string; after1440: string };
  };
  console.log(
    `| ${NAMES[key]} | ${r.desktop1440.elements} | **${r.desktop1440.geometryDiffs}** | ${r.header1440.before} / ${r.header1440.after} | ${r.desktop1440.pixels.diff} / ${r.desktop1440.pixels.total} | \`${r.shots.before1440}\`, \`${r.shots.after1440}\` |`
  );
}

if (tablet) {
  console.log("\n### Планшет 768 и 1024 — расхождений геометрии\n");
  console.log("| Страница | 768 | 1024 |");
  console.log("|---|---|---|");
  for (const [url, widths] of Object.entries(tablet as Record<string, Record<string, { elements: number; diffs: number }>>)) {
    console.log(`| ${url} | ${widths["768"]?.diffs} из ${widths["768"]?.elements} | ${widths["1024"]?.diffs} из ${widths["1024"]?.elements} |`);
  }
}

if (mini) {
  console.log("\n### Мини-приложение (кука ws-shell=mini, 390) — расхождений геометрии\n");
  console.log("| Страница | Оболочка .mini-root | Элементов | Расхождений |");
  console.log("|---|---|---|---|");
  for (const [url, v] of Object.entries(mini as Record<string, { miniRoot?: boolean; elements?: number; diffs?: number }>)) {
    if (url.startsWith("__")) continue;
    console.log(`| ${url} | ${v.miniRoot ? "да" : "нет"} | ${v.elements} | **${v.diffs}** |`);
  }
  console.log("\nПрилипание шапки (прокрутка на 1200 px):", JSON.stringify(mini.__sticky));
  console.log("\nНачало содержимого (390):", JSON.stringify(mini.__contentStart));
}

console.log("\n### Дополнительные страницы (регрессионный обход)\n");
console.log("| # | Путь | < 48 px до → после | кегль до → после | расхождений геометрии 1440 |");
console.log("|---|---|---|---|---|");
for (const [key, row] of Object.entries(ev.extraPages.rows as Record<string, Record<string, unknown>>)) {
  const r = row as { path: string; below48: { before: number; after: number }; textMedianPx: { before: number; after: number }; desktop1440GeometryDiffs: number };
  console.log(`| ${key} | ${r.path} | ${r.below48.before} → ${r.below48.after} | ${r.textMedianPx.before} → ${r.textMedianPx.after} | ${r.desktop1440GeometryDiffs} |`);
}
console.log("\nСигналы регрессии:", JSON.stringify(ev.extraPages.regressions), "\nСигналы по 8 страницам:", JSON.stringify(ev.verdict.signals));
console.log("\nОкно «Настройки документа» (390):", JSON.stringify({ before: ev.dialog390.before, after: ev.dialog390.after }));

if (desktop) {
  console.log("\n### Повторная проверка 1440 с ожиданием покоя (desktop-recheck.ts) и мини-приложение 390 после загрузки шрифтов\n");
  console.log("| Страница | Элементов | Замеров до покоя (до / после) | Расхождений |");
  console.log("|---|---|---|---|");
  for (const [url, v] of Object.entries(desktop as Record<string, { elements: number; samplesBefore: number; samplesAfter: number; diffs: number }>)) {
    console.log(`| ${url} | ${v.elements} | ${v.samplesBefore} / ${v.samplesAfter} | **${v.diffs}** |`);
  }
}
if (layer) console.log("\nЯрусы правила (layer-check.json):", JSON.stringify(layer));
