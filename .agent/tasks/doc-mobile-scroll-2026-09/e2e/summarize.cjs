// Таблицы «до/после» по журналам из raw/before.json и raw/after.json.
//   node D:/wt-build/tmp-docscroll/e2e/summarize.cjs  → raw/summary.md + raw/summary.json
// «До» и «после» — разные посевы одной и той же организации-образца (после перебазирования
// ветки базу засеяли заново), сравнение — по коду журнала и режиму.
const fs = require("node:fs");
const path = require("node:path");
const { OUT, readCreds } = require("./lib.cjs");

function load(label) {
  const file = path.join(OUT, "raw", `${label}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

/** Короткая сводка по одному замеру: ✓ или список проблем (одинаково для «до» и «после»). */
function cell(row) {
  if (!row) return "не замерено";
  if (row.error) return `✗ ошибка загрузки: ${row.error.split("\n")[0].slice(0, 80)}`;
  const p = [];
  if (row.scrollY !== 0) p.push(`окно y=${Math.round(row.scrollY)}`);
  if (row.scrollX !== 0) p.push(`окно x=${Math.round(row.scrollX)}`);
  if (row.docScrollWidth > row.vw + 1) p.push(`страница ${row.docScrollWidth}px`);
  if (row.pan && /(auto|scroll)/.test(row.pan.overflowX) && row.pan.scrollWidth > row.pan.clientWidth + 1)
    p.push(`вбок едет вся страница (${row.pan.scrollWidth}px)`);
  if (row.maxScrollLeft > 0) p.push(`таблица sl=${Math.round(row.maxScrollLeft)}`);
  if (row.h1 && row.h1.left < 0) p.push(`H1 срезан (${Math.round(row.h1.left)})`);
  if (row.headerAdd && row.headerAdd.left < 0) p.push(`«Добавить» срезана (${Math.round(row.headerAdd.left)})`);
  if (row.outside) p.push(`вылезает ${row.outside.over}px`);
  if (row.swipe && row.swipe.moved > 0) {
    if (row.swipe.h1 && row.h1 && Math.abs(row.swipe.h1.left - row.h1.left) > 1) p.push("H1 едет с таблицей");
    if (row.swipe.add && row.swipe.add.left < 0) p.push("«Добавить» уезжает с таблицей");
  }
  return p.length ? `✗ ${p.join(", ")}` : "✓";
}

const before = load("before");
const after = load("after");
const creds = readCreds();
const codes = [...new Set(creds.documents.filter((d) => d.status === "active").map((d) => d.code))];
const names = Object.fromEntries(creds.documents.map((d) => [d.code, d.journal]));
const pick = (set, list, code, mode) => (set ? set[list].find((r) => r.code === code && r.mode === mode) : null);
const MODES = ["phone", "phoneTable", "desktop"];

const rows = [];
const totals = {
  documentCells: 0,
  before: 0,
  after: 0,
  afterNotMeasured: 0,
  journalCells: 0,
  journalBefore: 0,
  journalAfter: 0,
  journalAfterNotMeasured: 0,
};
let md =
  "| Журнал | Телефон, вид по умолчанию: до → после | Телефон, «Таблица»: до → после | Компьютер 1280: до → после | Страница журнала, телефон / компьютер: до → после |\n|---|---|---|---|---|\n";
let mdAfter = "| Журнал | Телефон, по умолчанию | Телефон, «Таблица» | Компьютер 1280 | Страница журнала (телефон / компьютер) |\n|---|---|---|---|---|\n";
for (const code of codes) {
  const r = { code, journal: names[code] };
  const cols = [];
  const afterCols = [];
  for (const mode of MODES) {
    const b = cell(pick(before, "documents", code, mode));
    const a = cell(pick(after, "documents", code, mode));
    r[mode] = { before: b, after: a };
    totals.documentCells += 1;
    if (b !== "✓") totals.before += 1;
    if (a === "не замерено") totals.afterNotMeasured += 1;
    else if (a !== "✓") totals.after += 1;
    cols.push(`${b} → ${a}`);
    afterCols.push(a);
  }
  const jp = ["phone", "desktop"].map((mode) => ({
    b: cell(pick(before, "journals", code, mode)),
    a: cell(pick(after, "journals", code, mode)),
  }));
  for (const { b, a } of jp) {
    totals.journalCells += 1;
    if (b !== "✓") totals.journalBefore += 1;
    if (a === "не замерено") totals.journalAfterNotMeasured += 1;
    else if (a !== "✓") totals.journalAfter += 1;
  }
  const jb = jp.map((x) => x.b).join(" / ");
  const ja = jp.map((x) => x.a).join(" / ");
  r.journalPage = { before: jb, after: ja };
  cols.push(`${jb} → ${ja}`);
  afterCols.push(ja);
  rows.push(r);
  md += `| \`${code}\` ${names[code] ?? ""} | ${cols.join(" | ")} |\n`;
  mdAfter += `| \`${code}\` ${names[code] ?? ""} | ${afterCols.join(" | ")} |\n`;
}
const totalsLine =
  `Документы (45 журналов × 3 режима = ${totals.documentCells} замеров): с проблемой до — ${totals.before}, после — ${totals.after}` +
  `${totals.afterNotMeasured ? ` (не замерено ${totals.afterNotMeasured})` : ""}. ` +
  `Страницы журналов (${totals.journalCells} замеров): до — ${totals.journalBefore}, после — ${totals.journalAfter}` +
  `${totals.journalAfterNotMeasured ? ` (не замерено ${totals.journalAfterNotMeasured})` : ""}.`;
md += `\n${totalsLine}\n`;
mdAfter += `\n${totalsLine}\n`;
fs.writeFileSync(path.join(OUT, "raw", "summary.md"), md);
fs.writeFileSync(path.join(OUT, "raw", "summary-after.md"), mdAfter);
fs.writeFileSync(path.join(OUT, "raw", "summary.json"), JSON.stringify({ totals, stoppedAt: after ? after.stoppedAt ?? null : null, rows }, null, 2));
console.log(mdAfter);
console.log(totalsLine);
