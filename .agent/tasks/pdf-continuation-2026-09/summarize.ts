/**
 * Таблицы для evidence.md из raw/*.json:
 *   • страницы master → только шрифт → ветка (все наборы, по журналам);
 *   • проверка перекрытий по наборам;
 *   • распознавание QR (стр. 1 — плитка, продолжение — компактный код);
 *   • самый мелкий кегль до/после.
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/summarize.ts
 * Итог — raw/tables.md.
 */
import fs from "node:fs";
import path from "node:path";

const RAW = path.join(process.cwd(), ".agent", "tasks", "pdf-continuation-2026-09", "raw");
const read = <T,>(name: string): T | null => {
  const file = path.join(RAW, name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
};

type PageRow = { set: string; label: string; code: string; pages: number; bytes: number };
const out: string[] = [];

// ---------------------------------------------------------------------------
// Страницы
// ---------------------------------------------------------------------------
const master = read<PageRow[]>("pages-master.json")!;
const font = read<PageRow[]>("pages-font.json");
const branch = read<PageRow[]>("pages-branch.json")!;
const key = (r: PageRow) => `${r.set}:${r.label}`;
const byKey = (rows: PageRow[] | null) => new Map((rows ?? []).map((r) => [key(r), r]));
const m = byKey(master);
const f = byKey(font);
const b = byKey(branch);
const cell = (k: string) => {
  const a = m.get(k)?.pages;
  const c = b.get(k)?.pages;
  const mid = f.get(k)?.pages;
  if (a === undefined || c === undefined) return "—";
  const text = mid !== undefined && mid !== a && mid !== c ? `${a} → ${mid} → ${c}` : `${a} → ${c}`;
  return c < a ? `**${text}**` : c > a ? `❗${text}` : text;
};
out.push("### Страниц: master → шрифт с засечками → ветка (шрифт + компактная шапка продолжений)\n");
out.push("Одни и те же входы (`journal-qr-header-2026-09/pages.ts`). Жирным — стало меньше; средняя цифра — только смена шрифта (коммит 2), если она отличается.\n");
out.push("| Журнал | образец | шаблон /qb | длинный документ | с подвалом партнёра |");
out.push("|---|---|---|---|---|");
const codes = [...new Set(master.filter((r) => r.set === "samples").map((r) => r.code))];
for (const code of codes) {
  out.push(`| ${code} | ${cell(`samples:${code}`)} | ${cell(`blanks:${code}`)} | ${cell(`long:${code}`)} | ${cell(`variants:partner-${code}`)} |`);
}
out.push(`| гигиена по Приложению №1 (образец) | — | — | — | ${cell("variants:hygiene-v2")} |`);
out.push("");
out.push("| Бумажный бланк (шаблон /qb) | Страниц master → ветка |");
out.push("|---|---|");
for (const r of master.filter((row) => row.set === "paper")) out.push(`| ${r.label} | ${cell(key(r))} |`);
out.push("");
out.push("| Набор | PDF | Страниц master | Только шрифт | Ветка | Меньше | Больше | Размер PDF master → ветка, МБ |");
out.push("|---|---|---|---|---|---|---|---|");
for (const set of ["samples", "blanks", "long", "paper", "variants"]) {
  const rows = master.filter((r) => r.set === set);
  const sum = (map: Map<string, PageRow>) => rows.reduce((s, r) => s + (map.get(key(r))?.pages ?? 0), 0);
  const bytes = (map: Map<string, PageRow>) => rows.reduce((s, r) => s + (map.get(key(r))?.bytes ?? 0), 0) / 1048576;
  const less = rows.filter((r) => (b.get(key(r))?.pages ?? 0) < r.pages).length;
  const more = rows.filter((r) => (b.get(key(r))?.pages ?? 0) > r.pages).length;
  out.push(
    `| ${set} | ${rows.length} | ${sum(m)} | ${font ? sum(f) : "—"} | ${sum(b)} | ${less} | ${more} | ${bytes(m).toFixed(1)} → ${bytes(b).toFixed(1)} |`,
  );
}
out.push("");

// ---------------------------------------------------------------------------
// Перекрытия
// ---------------------------------------------------------------------------
type OverlapCase = {
  set: string;
  label: string;
  ok: boolean;
  pages: number;
  pagesHeader: number;
  pagesCorner: number;
  pagesNone: number;
  results: Array<{
    variant: string | null;
    inkBeforeStamp: number;
    changedOutside: number;
    moduleMismatches: number;
    alignDiffMm: number | null;
    marginsOk: boolean;
    knownOverflow: string | null;
  }>;
};
out.push("### Проверка «ничего не перекрыто» (check-qr-overlap.ts)\n");
out.push("| Набор | Бланков OK | Страниц | QR в шапке: стр. 1 (плитка) / продолжения (компактный) | В углу без шапки | Без QR | Чернил пробы на месте QR (макс.) | Изменено штампом вне QR (макс., px) | Расхождений модулей (макс.) | «Вровень», макс., мм | Поля 10 ± 1 | Известное вылезание |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const set of ["samples", "blanks", "long", "paper", "variants", "portrait"]) {
  const rows = read<OverlapCase[]>(`check-overlap-${set}.json`);
  if (!rows) continue;
  const pages = rows.flatMap((r) => r.results);
  const max = (pick: (p: OverlapCase["results"][number]) => number) => Math.max(0, ...pages.map(pick));
  const align = pages.map((p) => p.alignDiffMm).filter((v): v is number => v !== null);
  const known = rows.filter((r) => r.results.some((p) => p.knownOverflow)).map((r) => r.label);
  out.push(
    `| ${set} | ${rows.filter((r) => r.ok).length}/${rows.length} | ${pages.length} | ${pages.filter((p) => p.variant === "tile").length} / ${pages.filter((p) => p.variant === "compact").length} | ${rows.reduce((s, r) => s + r.pagesCorner, 0)} | ${rows.reduce((s, r) => s + r.pagesNone, 0)} | ${max((p) => (p.knownOverflow ? 0 : p.inkBeforeStamp))} | ${max((p) => p.changedOutside)} | ${max((p) => p.moduleMismatches)} | ${align.length ? Math.max(...align).toFixed(2) : "—"} | ${pages.filter((p) => p.marginsOk).length}/${pages.length} | ${known.length ? known.join(", ") : "—"} |`,
  );
}
out.push("");

// ---------------------------------------------------------------------------
// Распознавание
// ---------------------------------------------------------------------------
type DecodeRow = { set: string; role: string; dpi: number; kind: string; jsqr: boolean; zxing: boolean; acceptJsqr: boolean; acceptZxing: boolean; modules: number; moduleMm: number };
const decode = read<DecodeRow[]>("decode-samples+blanks+long+paper+variants.json");
if (decode) {
  out.push("### Распознавание QR: стр. 1 (фирменная плитка) и продолжение (компактный код)\n");
  const pagesFirst = decode.filter((r) => r.role === "first" && r.dpi === 300 && r.kind === "clean").length;
  const pagesRepeat = decode.filter((r) => r.role === "repeat" && r.dpi === 300 && r.kind === "clean").length;
  out.push(`Первых страниц — ${pagesFirst} (все бланки наборов), продолжений с шапкой — ${pagesRepeat} (первое продолжение у бланков с повтором шапки).\n`);
  out.push("| Снимок | dpi | стр. 1 — jsQR | стр. 1 — zxing-cpp | продолжение — jsQR | продолжение — zxing-cpp | Приёмка |");
  out.push("|---|---|---|---|---|---|---|");
  const kinds = ["clean", "bw", "bw-print", "phone", "bw-phone", "phone-hard", "bw-phone-hard"];
  const names: Record<string, string> = {
    clean: "чистый",
    bw: "ч/б (серый + порог)",
    "bw-print": "ч/б принтер",
    phone: "телефон",
    "bw-phone": "ч/б + телефон",
    "phone-hard": "жёсткий телефон (стресс)",
    "bw-phone-hard": "ч/б + жёсткий телефон (стресс)",
  };
  for (const dpi of [300, 150]) {
    for (const kind of kinds) {
      const pick = (role: string, dec: "jsqr" | "zxing") => {
        const list = decode.filter((r) => r.role === role && r.dpi === dpi && r.kind === kind);
        return list.length ? `${list.filter((r) => r[dec]).length}/${list.length}` : "—";
      };
      const sample = decode.find((r) => r.dpi === dpi && r.kind === kind);
      const acc = sample?.acceptJsqr ? "jsQR + zxing" : sample?.acceptZxing ? "zxing" : "стресс";
      out.push(`| ${names[kind]} | ${dpi} | ${pick("first", "jsqr")} | ${pick("first", "zxing")} | ${pick("repeat", "jsqr")} | ${pick("repeat", "zxing")} | ${acc} |`);
    }
  }
  const accJ = decode.filter((r) => r.acceptJsqr);
  const accZ = decode.filter((r) => r.acceptZxing);
  out.push("");
  out.push(`Приёмка: jsQR ${accJ.filter((r) => r.jsqr).length}/${accJ.length}, zxing-cpp ${accZ.filter((r) => r.zxing).length}/${accZ.length}.`);
  const mods = (role: string) => [...new Set(decode.filter((r) => r.role === role).map((r) => `${r.modules} мод. × ${r.moduleMm} мм`))].join(", ");
  out.push(`Коды: стр. 1 — ${mods("first")}; продолжение — ${mods("repeat")}.`);
  out.push("");
}

// ---------------------------------------------------------------------------
// Кегли
// ---------------------------------------------------------------------------
type Sizes = { histogram: Array<[number, number]>; perCase: Array<{ set: string; label: string; min: number; sample: string; below65: number; items: number }> };
const before = read<Sizes>("text-sizes-master.json");
const after = read<Sizes>("text-sizes-branch.json");
if (before && after) {
  out.push("### Самый мелкий текст на бланках (кегль строки по pdf.js, pt; без слова в полосе QR)\n");
  out.push("| Бланк | master (DejaVu Sans) | ветка (Liberation Serif) | строк мельче 6,5 pt: master → ветка |");
  out.push("|---|---|---|---|");
  const a = new Map(after.perCase.map((r) => [`${r.set}:${r.label}`, r]));
  for (const r of before.perCase) {
    const x = a.get(`${r.set}:${r.label}`);
    if (!x || (r.min >= 7 && x.min >= 7)) continue;
    out.push(`| ${r.set}:${r.label} | ${r.min} («${r.sample}») | ${x.min} («${x.sample}») | ${r.below65} → ${x.below65} |`);
  }
  const minOf = (s: Sizes) => Math.min(...s.perCase.map((r) => r.min));
  out.push("");
  out.push(`Самый мелкий текст всех образцов и бумажных бланков: master ${minOf(before)} pt → ветка ${minOf(after)} pt.`);
  out.push("");
}

fs.writeFileSync(path.join(RAW, "tables.md"), out.join("\n"));
console.log(out.join("\n"));
