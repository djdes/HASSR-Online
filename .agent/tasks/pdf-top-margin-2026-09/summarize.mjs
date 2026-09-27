// Сводка замеров полей «до/после» → markdown-таблицы и компактный JSON.
//
//   node .agent/tasks/pdf-top-margin-2026-09/summarize.mjs <before-samples.json> <after-samples.json> [<before-docs.json> <after-docs.json>]
//
// Пишет raw/margins-summary.json и печатает таблицы для evidence.md.
import fs from "node:fs";
import path from "node:path";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-top-margin-2026-09");
const M = 10;
const TOL = 1;
const [beforeSamples, afterSamples, beforeDocs, afterDocs] = process.argv.slice(2);
const read = (file) => (file ? JSON.parse(fs.readFileSync(file, "utf8")) : null);

const f1 = (value) => (value === null || value === undefined ? "—" : value.toFixed(1));
const sides = (p) => (p ? `${f1(p.top)} / ${f1(p.bottom)} / ${f1(p.left)} / ${f1(p.right)}` : "—");
const symmetric = (p) => ["top", "bottom", "left", "right"].every((s) => p[s] !== null && Math.abs(p[s] - M) <= TOL);
const range = (pages, side) => {
  const values = pages.map((p) => p[side]).filter((v) => v !== null);
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
};

function compare(before, after) {
  const byCode = new Map(before.map((r) => [r.code, r]));
  return after.map((a) => {
    const b = byCode.get(a.code);
    const pages = a.pagesMargins;
    return {
      code: a.code,
      pagesBefore: b?.pages ?? null,
      pagesAfter: a.pages,
      before: b
        ? {
            page1: b.pagesMargins[0],
            continuation: b.pagesMargins[1] ?? null,
            symmetricPages: b.pagesMargins.filter(symmetric).length,
          }
        : null,
      after: {
        page1: pages[0],
        continuation: pages[1] ?? null,
        symmetricPages: pages.filter(symmetric).length,
        asymmetric: pages.filter((p) => !symmetric(p)).map((p) => ({ page: p.page, top: p.top, bottom: p.bottom, left: p.left, right: p.right })),
        range: { top: range(pages, "top"), bottom: range(pages, "bottom"), left: range(pages, "left"), right: range(pages, "right") },
      },
      qrUpAfter: a.qrUp,
      ok: pages.every(symmetric),
    };
  });
}

function trimPage(p) {
  return p ? { page: p.page, orientation: p.orientation, top: p.top, bottom: p.bottom, left: p.left, right: p.right } : null;
}

const summary = {};
for (const [kind, b, a] of [
  ["samples", read(beforeSamples), read(afterSamples)],
  ["docs", read(beforeDocs), read(afterDocs)],
]) {
  if (!b || !a) continue;
  const rows = compare(b, a);
  summary[kind] = {
    journals: rows.length,
    journalsOk: rows.filter((r) => r.ok).length,
    pagesBefore: rows.reduce((s, r) => s + (r.pagesBefore ?? 0), 0),
    pagesAfter: rows.reduce((s, r) => s + r.pagesAfter, 0),
    pagesGrew: rows.filter((r) => r.pagesBefore !== null && r.pagesAfter > r.pagesBefore).map((r) => r.code),
    rows: rows.map((r) => ({
      ...r,
      before: r.before && { ...r.before, page1: trimPage(r.before.page1), continuation: trimPage(r.before.continuation) },
      after: { ...r.after, page1: trimPage(r.after.page1), continuation: trimPage(r.after.continuation) },
    })),
  };

  console.log(`\n### ${kind === "samples" ? "Образцы" : "Настоящие документы"}: поля по растру, мм (верх / низ / лево / право)\n`);
  if (kind === "samples") {
    console.log("| Журнал | Страниц до → после | До: стр. 1 | После: стр. 1 | После: стр. 2 (продолжение) | Все страницы 10 ± 1 |");
    console.log("|---|---|---|---|---|---|");
    for (const r of rows) {
      console.log(
        `| ${r.code} | ${r.pagesBefore} → ${r.pagesAfter} | ${sides(r.before?.page1)} | ${sides(r.after.page1)} | ${sides(r.after.continuation)} | ${
          r.ok ? `да (${r.after.symmetricPages}/${r.pagesAfter})` : `НЕТ (${r.after.symmetricPages}/${r.pagesAfter})`
        } |`,
      );
    }
  } else {
    console.log("| Журнал | Страниц до → после | До: стр. 1 | После: стр. 1 | После: продолжения (мин–макс по сторонам) | Страниц 10 ± 1 |");
    console.log("|---|---|---|---|---|---|");
    for (const r of rows) {
      const rg = r.after.range;
      const cont = r.pagesAfter > 1
        ? ["top", "bottom", "left", "right"].map((s) => (rg[s] ? `${f1(rg[s][0])}–${f1(rg[s][1])}` : "—")).join(" / ")
        : "—";
      console.log(
        `| ${r.code} | ${r.pagesBefore} → ${r.pagesAfter} | ${sides(r.before?.page1)} | ${sides(r.after.page1)} | ${cont} | ${r.after.symmetricPages}/${r.pagesAfter}${r.ok ? "" : " ⚠"} |`,
      );
    }
  }
  const s = summary[kind];
  console.log(
    `\nИтого: ${s.journalsOk}/${s.journals} журналов — все страницы с полями ${M} ± ${TOL} мм; страниц ${s.pagesBefore} → ${s.pagesAfter}; ` +
      `страниц стало больше: ${s.pagesGrew.length ? s.pagesGrew.join(", ") : "ни у одного"}.`,
  );
}

fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
fs.writeFileSync(path.join(TASK_DIR, "raw", "margins-summary.json"), JSON.stringify(summary, null, 1));
