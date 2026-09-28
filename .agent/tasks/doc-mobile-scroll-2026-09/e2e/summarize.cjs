// Таблица «до/после» по журналам из raw/before.json и raw/after.json.
//   node D:/wt-build/tmp-docscroll/e2e/summarize.cjs  → raw/summary.md + raw/summary.json
const fs = require("node:fs");
const path = require("node:path");
const { OUT, readCreds } = require("./lib.cjs");

function load(label) {
  const file = path.join(OUT, "raw", `${label}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

/** Короткая сводка по одному замеру: ✓ или список проблем (одинаково для «до» и «после»). */
function cell(row) {
  if (!row) return "—";
  if (row.error) return "ошибка загрузки";
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
// Прогон «после» по итоговому коду остановлен правилом окружения (на C: < 700 МБ):
// берём то, что успели замерить (raw/after-partial.json), и точечные пробы.
const partial = load("after-partial");
const PROBES = {
  "pest_control|phoneTable": "✓ (проба)",
  "pest_control|desktop": "✓ (проба)",
  "disinfectant_usage|phoneTable": "✓ (проба)",
  "disinfectant_usage|desktop": "✓ (проба)",
  "accident_journal|phoneTable": "✓ (проба)",
};
function afterCell(code, mode) {
  if (after) return cell(pick(after, "documents", code, mode));
  const row = partial && partial.rows.find((r) => r.code === code && r.mode === mode);
  if (row) return row.verdict === "✓" ? "✓" : `✗ ${row.verdict}`;
  return PROBES[`${code}|${mode}`] ?? "не замерено";
}
const creds = readCreds();
const codes = [...new Set(creds.documents.filter((d) => d.status === "active").map((d) => d.code))];
const names = Object.fromEntries(creds.documents.map((d) => [d.code, d.journal]));
const pick = (set, list, code, mode) => (set ? set[list].find((r) => r.code === code && r.mode === mode) : null);

const rows = [];
let md = "| Журнал | Телефон, вид по умолчанию: до → после | Телефон, «Таблица»: до → после | Компьютер 1280: до → после | Страница журнала, телефон / компьютер: до → после |\n|---|---|---|---|---|\n";
const totals = { before: 0, after: 0, cells: 0 };
for (const code of codes) {
  const r = { code, journal: names[code] };
  const cols = [];
  for (const mode of ["phone", "phoneTable", "desktop"]) {
    const b = cell(pick(before, "documents", code, mode));
    const a = afterCell(code, mode);
    r[mode] = { before: b, after: a };
    totals.cells += 1;
    if (b !== "✓") totals.before += 1;
    if (a.startsWith("✗")) totals.after += 1;
    if (a === "не замерено") totals.notMeasured = (totals.notMeasured || 0) + 1;
    cols.push(`${b} → ${a}`);
  }
  const jb = `${cell(pick(before, "journals", code, "phone"))} / ${cell(pick(before, "journals", code, "desktop"))}`;
  const ja = after ? `${cell(pick(after, "journals", code, "phone"))} / ${cell(pick(after, "journals", code, "desktop"))}` : "не замерено";
  r.journalPage = { before: jb, after: ja };
  cols.push(`${jb} → ${ja}`);
  rows.push(r);
  md += `| \`${code}\` ${names[code] ?? ""} | ${cols.join(" | ")} |\n`;
}
md += `\nЗамеров документа с проблемой: до — ${totals.before} из ${totals.cells}; после — ${totals.after} ` +
  `(по итоговому коду не замерено ${totals.notMeasured || 0} из ${totals.cells}: прогон остановлен правилом «на C: < 700 МБ»).\n`;
fs.writeFileSync(path.join(OUT, "raw", "summary.md"), md);
fs.writeFileSync(path.join(OUT, "raw", "summary.json"), JSON.stringify({ totals, rows }, null, 2));
console.log(md);
