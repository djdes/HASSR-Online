/**
 * Сравнение снимков бланков master → после (`baseline.ts`): страниц не больше;
 * шапка не выросла — ячейка QR на каждой странице с шапкой не шире и не выше,
 * чем на master (высота ячейки = строки организации и названия); где стоит QR
 * (шапка / угол / нет) — по страницам.
 *
 *   node --import tsx .agent/tasks/qr-bw-minimal-2026-09/compare-baseline.ts [master] [after]
 * Итог — raw/compare-<после>.json.
 */
import fs from "node:fs";
import path from "node:path";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-bw-minimal-2026-09");
type Size = { w: number; h: number; x1: number; y0: number } | null;
type Case = {
  set: string;
  label: string;
  url: string;
  pages: number;
  modules: number | null;
  module: number | null;
  placements: Array<{ page: number; where: string; slot: Size; box: Size }>;
};

const load = (label: string) => JSON.parse(fs.readFileSync(path.join(TASK_DIR, "raw", `baseline-${label}.json`), "utf8")) as Case[];

function main() {
  const [a = "master", b = "after"] = process.argv.slice(2);
  const before = load(a);
  const after = load(b);
  const key = (c: Case) => `${c.set}:${c.label}`;
  const map = new Map(before.map((c) => [key(c), c]));
  const sets = new Map<string, { cases: number; pagesBefore: number; pagesAfter: number; more: string[]; fewer: string[] }>();
  let headerPages = 0;
  let wider = 0;
  let taller = 0;
  let maxDw = -Infinity;
  let maxDh = -Infinity;
  const placementChanges: string[] = [];
  const growthByModules = new Map<number, { before: number; after: number; widthBefore: number; widthAfter: number; moduleBefore: number; moduleAfter: number }>();
  for (const c of after) {
    const m = map.get(key(c));
    if (!m) throw new Error(`нет на ${a}: ${key(c)}`);
    const s = sets.get(c.set) ?? { cases: 0, pagesBefore: 0, pagesAfter: 0, more: [], fewer: [] };
    s.cases += 1;
    s.pagesBefore += m.pages;
    s.pagesAfter += c.pages;
    if (c.pages > m.pages) s.more.push(`${c.label} ${m.pages}→${c.pages}`);
    if (c.pages < m.pages) s.fewer.push(`${c.label} ${m.pages}→${c.pages}`);
    sets.set(c.set, s);
    if (c.url !== m.url && c.set !== "blanks" && c.set !== "paper") throw new Error(`адрес QR изменился: ${key(c)}`);
    for (const p of c.placements) {
      const q = m.placements.find((x) => x.page === p.page);
      if (q && q.where !== p.where) placementChanges.push(`${key(c)} стр. ${p.page}: ${q.where}→${p.where}`);
      if (p.where === "header" && q?.where === "header" && p.slot && q.slot) {
        headerPages += 1;
        const dw = p.slot.w - q.slot.w;
        const dh = p.slot.h - q.slot.h;
        if (dw > 1e-6) wider += 1;
        if (dh > 1e-6) taller += 1;
        maxDw = Math.max(maxDw, dw);
        maxDh = Math.max(maxDh, dh);
        if (c.modules && m.module && c.module) {
          const g = growthByModules.get(c.modules) ?? { before: 0, after: 0, widthBefore: 0, widthAfter: 0, moduleBefore: m.module, moduleAfter: c.module };
          g.before = Math.max(g.before, q.slot.h);
          g.after = Math.max(g.after, p.slot.h);
          g.widthBefore = Math.max(g.widthBefore, q.slot.w);
          g.widthAfter = Math.max(g.widthAfter, p.slot.w);
          growthByModules.set(c.modules, g);
        }
      }
    }
  }
  const summary = {
    documents: after.length,
    pagesBefore: [...sets.values()].reduce((x, s) => x + s.pagesBefore, 0),
    pagesAfter: [...sets.values()].reduce((x, s) => x + s.pagesAfter, 0),
    documentsWithMorePages: [...sets.values()].reduce((x, s) => x + s.more.length, 0),
    sets: Object.fromEntries(sets),
    headerPages,
    headerCellsWider: wider,
    headerCellsTaller: taller,
    maxWidthDeltaMm: +maxDw.toFixed(3),
    maxHeightDeltaMm: +maxDh.toFixed(3),
    byModules: Object.fromEntries([...growthByModules.entries()].sort((x, y) => x[0] - y[0])),
    placementChanges,
  };
  fs.writeFileSync(path.join(TASK_DIR, "raw", `compare-${b}.json`), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

main();
