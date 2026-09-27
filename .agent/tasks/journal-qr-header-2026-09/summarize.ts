/**
 * Таблицы для evidence.md из raw/*.json:
 *   pages-master.json, pages-after.json (pages.ts), check-overlap-<набор>.json
 *   (journal-pdf-qr-2026-09/check-qr-overlap.ts), decode-<наборы>.json (decode-matrix.ts).
 *
 *   npx tsx .agent/tasks/journal-qr-header-2026-09/summarize.ts > .agent/tasks/journal-qr-header-2026-09/raw/tables.md
 */
import fs from "node:fs";
import path from "node:path";

const RAW = path.join(process.cwd(), ".agent", "tasks", "journal-qr-header-2026-09", "raw");
const read = <T>(name: string): T | null => {
  const file = path.join(RAW, name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
};

type PagesRow = { set: string; label: string; code: string; pages: number; bytes?: number };
type OverlapPage = {
  page: number;
  where: "header" | "corner" | "none";
  modules: number;
  moduleMm: number;
  inkBeforeStamp: number;
  knownOverflow?: string | null;
  changedOutside: number;
  moduleMismatches: number;
  alignDiffMm: number | null;
  overflowSheet: boolean;
  marginsOk: boolean;
  ok: boolean;
};
type OverlapCase = { set: string; label: string; modules: number; pagesPlain: number; pages: number; results: OverlapPage[]; ok: boolean };
type DecodeRow = {
  set: string;
  label: string;
  page: number;
  role: string;
  where: string;
  modules: number;
  moduleMm: number;
  angle: number;
  dpi: number;
  kind: string;
  jsqr: boolean;
  zxing: boolean;
  acceptance: boolean;
};

const SETS: Array<[string, string]> = [
  ["samples", "образец"],
  ["blanks", "шаблон /qb"],
  ["long", "длинный документ"],
  ["variants", "с подвалом партнёра"],
];

function pagesTables(out: string[]) {
  const master = read<PagesRow[]>("pages-master.json") ?? [];
  const after = read<PagesRow[]>("pages-after.json") ?? [];
  const key = (r: PagesRow) => `${r.set}:${r.label}`;
  const m = new Map(master.map((r) => [key(r), r.pages]));
  const a = new Map(after.map((r) => [key(r), r.pages]));
  const cell = (set: string, label: string) => {
    const before = m.get(`${set}:${label}`);
    const now = a.get(`${set}:${label}`);
    if (before === undefined || now === undefined) return "—";
    return now < before ? `**${before} → ${now}**` : now > before ? `⚠ ${before} → ${now}` : `${before} → ${now}`;
  };
  out.push("### Страниц на master → сейчас (одни и те же входы)\n");
  out.push(`| Журнал | ${SETS.map(([, name]) => name).join(" | ")} |`);
  out.push(`|---|${SETS.map(() => "---").join("|")}|`);
  const codes = [...new Set(master.filter((r) => r.set === "samples").map((r) => r.label))];
  for (const code of codes) {
    out.push(`| ${code} | ${SETS.map(([set]) => cell(set, set === "variants" ? `partner-${code}` : code)).join(" | ")} |`);
  }
  out.push(`| гигиена по Приложению №1 (образец) | — | — | — | ${cell("variants", "hygiene-v2")} |`);
  out.push("");
  out.push("| Бумажный бланк (шаблон /qb) | Страниц master → сейчас |");
  out.push("|---|---|");
  for (const r of master.filter((row) => row.set === "paper")) out.push(`| ${r.label} | ${cell("paper", r.label)} |`);
  out.push("");
  const sum = (map: Map<string, number>, set: string) =>
    [...map.entries()].filter(([k]) => k.startsWith(`${set}:`)).reduce((s, [, v]) => s + v, 0);
  const bytesM = new Map(master.map((r) => [key(r), r.bytes ?? 0]));
  const bytesA = new Map(after.map((r) => [key(r), r.bytes ?? 0]));
  out.push("| Набор | PDF | Страниц master | Страниц сейчас | Меньше | Больше | Размер PDF master → сейчас, МБ |");
  out.push("|---|---|---|---|---|---|---|");
  for (const set of ["samples", "blanks", "long", "paper", "variants"]) {
    const keys = [...m.keys()].filter((k) => k.startsWith(`${set}:`));
    const less = keys.filter((k) => (a.get(k) ?? 0) < (m.get(k) ?? 0)).length;
    const more = keys.filter((k) => (a.get(k) ?? 0) > (m.get(k) ?? 0)).length;
    const mb = (map: Map<string, number>) => (keys.reduce((s2, k) => s2 + (map.get(k) ?? 0), 0) / 1048576).toFixed(1);
    out.push(`| ${set} | ${keys.length} | ${sum(m, set)} | ${sum(a, set)} | ${less} | ${more} | ${mb(bytesM)} → ${mb(bytesA)} |`);
  }
  out.push("");
}

function overlapTables(out: string[]) {
  const cases: OverlapCase[] = [];
  for (const set of ["samples", "blanks", "long", "paper", "variants", "portrait"]) cases.push(...(read<OverlapCase[]>(`check-overlap-${set}.json`) ?? []));
  if (!cases.length) return;
  out.push("### Проверка «ничего не перекрыто» (check-qr-overlap.ts)\n");
  out.push("| Набор | Бланков OK | Страниц | QR в шапке | QR в углу (нет шапки) | Без QR | Чернил пробы на месте QR (макс.) | Изменено штампом вне QR (макс., px) | Расхождений модулей (макс.) | «Вровень», макс. разница, мм | Поля 10 ± 1 (верх/лево/право), низ ≥ 9 | Известное вылезание таблицы на шапку |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const set of ["samples", "blanks", "long", "paper", "variants", "portrait"]) {
    const list = cases.filter((c) => c.set === set);
    if (!list.length) continue;
    const pages = list.flatMap((c) => c.results);
    const align = pages.map((p) => p.alignDiffMm).filter((v): v is number => v !== null);
    out.push(
      `| ${set} | ${list.filter((c) => c.ok).length}/${list.length} | ${pages.length} | ${pages.filter((p) => p.where === "header").length} | ` +
        `${pages.filter((p) => p.where === "corner").length} | ${pages.filter((p) => p.where === "none").length} | ` +
        `${Math.max(0, ...pages.filter((p) => !p.knownOverflow).map((p) => p.inkBeforeStamp))} | ${Math.max(0, ...pages.map((p) => p.changedOutside))} | ` +
        `${Math.max(0, ...pages.map((p) => p.moduleMismatches))} | ${align.length ? Math.max(...align).toFixed(2) : "—"} | ` +
        `${pages.filter((p) => p.marginsOk).length}/${pages.length} | ` +
        `${list.flatMap((c) => c.results.filter((p) => p.knownOverflow).map((p) => `${c.label} стр. ${p.page}`)).join(", ") || "—"} |`,
    );
  }
  out.push("");
  out.push("### Страницы без шапки\n");
  out.push("| Набор | Журнал | Страниц | QR в шапке | QR в правом верхнем углу (свободен) | Без QR (угол занят таблицей) |");
  out.push("|---|---|---|---|---|---|");
  const ranges = (nums: number[]) => {
    const parts: string[] = [];
    for (let i = 0; i < nums.length; i += 1) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
      parts.push(i === j ? `${nums[i]}` : `${nums[i]}–${nums[j]}`);
      i = j;
    }
    return parts.join(", ") || "—";
  };
  for (const c of cases) {
    const corner = c.results.filter((p) => p.where === "corner").map((p) => p.page);
    const none = c.results.filter((p) => p.where === "none").map((p) => p.page);
    if (!corner.length && !none.length) continue;
    out.push(
      `| ${c.set} | ${c.label} | ${c.pages} | ${ranges(c.results.filter((p) => p.where === "header").map((p) => p.page))} | ${ranges(corner)} | ${ranges(none)} |`,
    );
  }
  out.push("");
}

function decodeTables(out: string[]) {
  const rows: DecodeRow[] = [];
  // Только основные прогоны (`decode-<наборы>.json`); с меткой (`-variant-b`) — отдельно.
  for (const file of fs.readdirSync(RAW).filter((f) => /^decode-[a-z+]+\.json$/.test(f))) rows.push(...(read<DecodeRow[]>(file) ?? []));
  if (!rows.length) return;
  const kinds = ["clean", "bw", "bw-print", "phone", "bw-phone", "phone-hard", "bw-phone-hard"];
  const names: Record<string, string> = {
    clean: "чистый",
    bw: "ч/б (серый + порог)",
    "bw-print": "ч/б принтер",
    phone: "телефон",
    "bw-phone": "ч/б + телефон",
    "phone-hard": "телефон жёстко",
    "bw-phone-hard": "ч/б + телефон жёстко",
  };
  out.push("### Распознавание — сводка (все бланки, первая страница и повтор шапки)\n");
  out.push("| Снимок | dpi | px на модуль | jsQR | zxing-cpp | В приёмке |");
  out.push("|---|---|---|---|---|---|");
  for (const dpi of [150, 300]) {
    for (const kind of kinds) {
      const list = rows.filter((r) => r.dpi === dpi && r.kind === kind);
      if (!list.length) continue;
      const px = list.map((r) => (r.moduleMm * dpi) / 25.4);
      out.push(
        `| ${names[kind]} | ${dpi} | ${Math.min(...px).toFixed(1)}–${Math.max(...px).toFixed(1)} | ${list.filter((r) => r.jsqr).length}/${list.length} | ` +
          `${list.filter((r) => r.zxing).length}/${list.length} | ${list[0].acceptance ? "да" : "стресс"} |`,
      );
    }
  }
  const acc = rows.filter((r) => r.acceptance);
  out.push("");
  out.push(
    `Приёмка: jsQR **${acc.filter((r) => r.jsqr).length}/${acc.length}**, zxing-cpp **${acc.filter((r) => r.zxing).length}/${acc.length}** ` +
      `(${new Set(rows.map((r) => `${r.set}:${r.label}`)).size} бланков, ${new Set(rows.map((r) => `${r.set}:${r.label}:${r.page}`)).size} страниц).`,
  );
  out.push("");
  out.push("### Распознавание по бланкам и страницам\n");
  out.push("J — jsQR, Z — zxing-cpp, «·» — не прочитал. Порядок в группе: чистый / ч/б / ч/б принтер / телефон / ч/б + телефон; стресс — телефон и ч/б + телефон жёстко.\n");
  out.push("| Набор | Журнал | Стр. | n | Модуль, мм | Угол | 150 dpi | 300 dpi | Стресс 300 | Стресс 150 (телефон) |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  const mark = (r: DecodeRow | undefined) => (r ? `${r.jsqr ? "J" : "·"}${r.zxing ? "Z" : "·"}` : "—");
  const pages = [...new Set(rows.map((r) => `${r.set}|${r.label}|${r.page}`))];
  for (const key of pages) {
    const [set, label, page] = key.split("|");
    const list = rows.filter((r) => r.set === set && r.label === label && String(r.page) === page);
    const at = (dpi: number, kind: string) => mark(list.find((r) => r.dpi === dpi && r.kind === kind));
    const r0 = list[0];
    out.push(
      `| ${set} | ${label} | ${page}${r0.role === "repeat" ? " (повтор)" : ""} | ${r0.modules} | ${r0.moduleMm.toFixed(3)} | ${r0.angle}° | ` +
        `${["clean", "bw", "bw-print"].map((k) => at(150, k)).join(" ")} | ` +
        `${["clean", "bw", "bw-print", "phone", "bw-phone"].map((k) => at(300, k)).join(" ")} | ` +
        `${["phone-hard", "bw-phone-hard"].map((k) => at(300, k)).join(" ")} | ` +
        `${["phone", "bw-phone", "phone-hard", "bw-phone-hard"].map((k) => at(150, k)).join(" ")} |`,
    );
  }
  out.push("");
}

const out: string[] = [];
pagesTables(out);
overlapTables(out);
decodeTables(out);
process.stdout.write(out.join("\n") + "\n");
