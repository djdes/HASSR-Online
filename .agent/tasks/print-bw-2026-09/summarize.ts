/**
 * Сводка сканера цвета до/после: raw/scan-before.json и raw/scan-after.json
 * (scan-docs.ts), raw/e2e-before.json и raw/e2e-after.json (e2e-print.ts) →
 * таблица markdown в консоль и raw/summary.json.
 *
 * Запуск (из корня репо): npx tsx .agent/tasks/print-bw-2026-09/summarize.ts
 */
import fs from "node:fs";
import path from "node:path";

const RAW = path.join(process.cwd(), ".agent", "tasks", "print-bw-2026-09", "raw");

type DocResult = {
  set: string;
  label: string;
  kind: "pdf" | "docx";
  pages?: number;
  ops?: { coloredOps: number; coloredOutsideQr: number; coloredInQr: number; coloredUnused: number; palette: Record<string, number> };
  raster?: { colored: number; coloredVisible: number };
  docx?: { colored: unknown[]; themeRefs: unknown[] };
};

type E2eRow = {
  name: string;
  kind: string;
  pages: number;
  coloredOps: number;
  coloredOutsideQr: number;
  rasterColored: number;
  rasterVisible: number;
  palette: Record<string, number>;
  excluded: string;
};

const SET_TITLE: Record<string, string> = {
  samples: "Образцы 45 журналов (с QR)",
  blanks: "Шаблоны 45 журналов (QR /qb + копирайт)",
  long: "«Длинные» документы 45 журналов",
  paper: "Бумажные бланки (5)",
  variants: "Гигиена по Прил. № 1 + подвал партнёра у 45",
  portrait: "Образцы на книжном листе (45)",
  extra: "Гигиена + «Подписи сотрудников», просроченная поверка",
  checklists: "Чек-листы (проветривание, санитарный день)",
  regulator: "Пакет проверяющего: обложка, CAPA",
  orders: "Приказы (12 шаблонов)",
  billing: "Счёт, УПД, УПД-образец",
  docx: "Word-шаблоны (6 × без/с подвалом)",
};

function load<T>(name: string): T | null {
  const file = path.join(RAW, name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
}

function main() {
  const before = load<DocResult[]>("scan-before.json") ?? [];
  const after = load<DocResult[]>("scan-after.json") ?? [];
  const sets = [...new Set([...before, ...after].map((r) => r.set))];
  const lines: string[] = [];
  lines.push("| Набор | Док. | Стр. до → после | Док. с цветом до → после | Цветных операторов вне QR до → после | Цветных пикселей вне QR до → после |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  const summary: Record<string, unknown> = {};
  let totals = { docs: 0, pagesBefore: 0, pagesAfter: 0, coloredDocsBefore: 0, coloredDocsAfter: 0, opsBefore: 0, opsAfter: 0, pixBefore: 0, pixAfter: 0, docxAttrsBefore: 0, docxAttrsAfter: 0 };
  const pageRegressions: string[] = [];
  for (const set of sets) {
    const b = before.filter((r) => r.set === set);
    const a = after.filter((r) => r.set === set);
    if (b.every((r) => r.kind === "docx")) {
      const attrs = (rows: DocResult[]) => rows.reduce((s, r) => s + (r.docx?.colored.length ?? 0) + (r.docx?.themeRefs.length ?? 0), 0);
      const docsWith = (rows: DocResult[]) => rows.filter((r) => (r.docx?.colored.length ?? 0) + (r.docx?.themeRefs.length ?? 0) > 0).length;
      lines.push(`| ${SET_TITLE[set] ?? set} | ${b.length} | — | ${docsWith(b)} → ${docsWith(a)} | атрибутов XML: ${attrs(b)} → ${attrs(a)} | — |`);
      summary[set] = { docs: b.length, coloredDocs: [docsWith(b), docsWith(a)], attrs: [attrs(b), attrs(a)] };
      totals.docs += b.length;
      totals.coloredDocsBefore += docsWith(b);
      totals.coloredDocsAfter += docsWith(a);
      totals.docxAttrsBefore += attrs(b);
      totals.docxAttrsAfter += attrs(a);
      continue;
    }
    const pages = (rows: DocResult[]) => rows.reduce((s, r) => s + (r.pages ?? 0), 0);
    const colored = (r: DocResult) => (r.ops?.coloredOutsideQr ?? 0) + (r.raster?.colored ?? 0) > 0;
    const ops = (rows: DocResult[]) => rows.reduce((s, r) => s + (r.ops?.coloredOutsideQr ?? 0), 0);
    const pix = (rows: DocResult[]) => rows.reduce((s, r) => s + (r.raster?.colored ?? 0), 0);
    for (const r of a) {
      const old = b.find((x) => x.label === r.label);
      if (old && (r.pages ?? 0) > (old.pages ?? 0)) pageRegressions.push(`${set}:${r.label} ${old.pages} → ${r.pages}`);
    }
    lines.push(
      `| ${SET_TITLE[set] ?? set} | ${b.length} | ${pages(b)} → ${pages(a)} | ${b.filter(colored).length} → ${a.filter(colored).length} | ${ops(b)} → ${ops(a)} | ${pix(b)} → ${pix(a)} |`,
    );
    summary[set] = {
      docs: b.length,
      pages: [pages(b), pages(a)],
      coloredDocs: [b.filter(colored).length, a.filter(colored).length],
      opsOutsideQr: [ops(b), ops(a)],
      pixelsOutsideQr: [pix(b), pix(a)],
    };
    totals.docs += b.length;
    totals.pagesBefore += pages(b);
    totals.pagesAfter += pages(a);
    totals.coloredDocsBefore += b.filter(colored).length;
    totals.coloredDocsAfter += a.filter(colored).length;
    totals.opsBefore += ops(b);
    totals.opsAfter += ops(a);
    totals.pixBefore += pix(b);
    totals.pixAfter += pix(a);
  }
  lines.push(
    `| **Итого** | **${totals.docs}** | **${totals.pagesBefore} → ${totals.pagesAfter}** | **${totals.coloredDocsBefore} → ${totals.coloredDocsAfter}** | **${totals.opsBefore} → ${totals.opsAfter}** (DOCX: ${totals.docxAttrsBefore} → ${totals.docxAttrsAfter}) | **${totals.pixBefore} → ${totals.pixAfter}** |`,
  );
  console.log(lines.join("\n"));
  console.log(`\nстраниц больше: ${pageRegressions.length ? pageRegressions.join(", ") : "нигде"}`);

  // Палитра «до» — какие цвета были.
  const palette: Record<string, number> = {};
  for (const r of before) for (const [c, n] of Object.entries(r.ops?.palette ?? {})) palette[c] = (palette[c] ?? 0) + n;
  console.log(`\nпалитра до (цвет → операторов вне QR): ${JSON.stringify(palette)}`);

  // Печать с сайта (e2e).
  const eb = load<E2eRow[]>("e2e-before.json") ?? [];
  const ea = load<E2eRow[]>("e2e-after.json") ?? [];
  if (eb.length || ea.length) {
    const e2e: string[] = [];
    e2e.push("| Документ | Как печатается | Стр. до → после | Цветных операторов вне QR до → после | Цветных пикселей до → после (заметных) | Цвета «до» |");
    e2e.push("|---|---|---:|---:|---:|---|");
    for (const row of eb) {
      const next = ea.find((r) => r.name === row.name);
      e2e.push(
        `| ${row.name} | ${row.kind === "browser-print" ? "печать браузером" : "PDF с сервера"} | ${row.pages} → ${next?.pages ?? "—"} | ${row.coloredOutsideQr} → ${next?.coloredOutsideQr ?? "—"} | ${row.rasterColored} (${row.rasterVisible}) → ${next ? `${next.rasterColored} (${next.rasterVisible})` : "—"} | ${Object.keys(row.palette).slice(0, 6).join("; ") || "—"} |`,
      );
    }
    console.log(`\n${e2e.join("\n")}`);
    summary.e2e = { before: eb, after: ea };
  }
  summary.totals = totals;
  summary.pageRegressions = pageRegressions;
  summary.paletteBefore = palette;
  fs.writeFileSync(path.join(RAW, "summary.json"), JSON.stringify(summary, null, 1));
}

main();
