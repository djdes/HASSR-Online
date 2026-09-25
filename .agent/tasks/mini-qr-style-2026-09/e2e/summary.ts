// Сводка автопроверки до/после: таблица для evidence.md и evidence.json.
// Запуск: npx tsx .agent/tasks/mini-qr-style-2026-09/e2e/summary.ts
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const EVIDENCE = path.join(HERE, "..", "evidence");

type Row = {
  theme: string;
  screen: string;
  final: string;
  hScroll: boolean;
  scrollW: number;
  vw: number;
  headerH: number | null;
  navH: number | null;
  controls: number;
  small: number;
  smallList: string[];
  smallFont: string[];
  near: number;
  nearList: string[];
  lowContrast: string[];
  textChecked: number;
  bodyFontMedian: number | null;
};

function load(phase: string): Row[] {
  return JSON.parse(fs.readFileSync(path.join(EVIDENCE, phase, "report.json"), "utf8")) as Row[];
}

const before = load("before");
const after = load("after");
const key = (r: Row) => `${r.theme}/${r.screen}`;
const beforeBy = new Map(before.map((r) => [key(r), r]));

const lines: string[] = [];
lines.push("| Экран (тема) | Шапка, px до→после | Меню, px | Кнопок/полей < 48px до→после | Шрифт полей < 16px | Гориз. прокрутка | Текст с контрастом < 4.5:1 до→после |");
lines.push("|---|---|---|---|---|---|---|");
for (const a of after) {
  const b = beforeBy.get(key(a));
  lines.push(
    `| ${a.screen} (${a.theme}) | ${b?.headerH ?? "—"}→${a.headerH} | ${b?.navH ?? "—"}→${a.navH} | ${b?.small ?? "—"}→${a.small} из ${a.controls} | ${a.smallFont.length} | ${a.hScroll ? `да (${a.scrollW}>${a.vw})` : "нет"} | ${b?.lowContrast.length ?? "—"}→${a.lowContrast.length} из ${a.textChecked} |`
  );
}
const totals = {
  screens: after.length,
  smallAfter: after.reduce((n, r) => n + r.small, 0),
  smallBefore: before.reduce((n, r) => n + r.small, 0),
  smallFontAfter: after.reduce((n, r) => n + r.smallFont.length, 0),
  hScrollAfter: after.filter((r) => r.hScroll).length,
  lowContrastAfter: after.reduce((n, r) => n + r.lowContrast.length, 0),
  lowContrastBefore: before.reduce((n, r) => n + r.lowContrast.length, 0),
  headerMaxAfter: Math.max(...after.map((r) => r.headerH ?? 0)),
  nearAfter: after.reduce((n, r) => n + r.near, 0),
};
console.log(lines.join("\n"));
console.log("\n" + JSON.stringify(totals, null, 1));
const leftovers = after.filter((r) => r.small || r.smallFont.length || r.lowContrast.length || r.near);
for (const r of leftovers) {
  console.log(`\n# ${r.theme}/${r.screen}`);
  if (r.small) console.log("  small:", r.smallList.join(" | "));
  if (r.smallFont.length) console.log("  smallFont:", r.smallFont.join(" | "));
  if (r.lowContrast.length) console.log("  lowContrast:", r.lowContrast.join(" | "));
  if (r.near) console.log("  near:", r.nearList.join(" | "));
}
fs.writeFileSync(path.join(EVIDENCE, "summary.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(EVIDENCE, "summary.json"), JSON.stringify(totals, null, 1) + "\n");
