/* eslint-disable no-console */
/**
 * Сравнение «до/после» и вердикты по критериям приёмки.
 *
 *   npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/compare.ts
 *
 * Читает results-before.json и results-after.json (measure.ts), сравнивает
 * геометрию каждого видимого элемента на 1440 и попиксельно — скриншоты
 * 1440 (canvas в headless Chromium), проверяет замеры 390. Пишет
 * ../evidence.json и печатает сводку.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const DIR = __dirname;
const TASK = path.resolve(DIR, "..");
const SHOTS = path.join(TASK, "evidence");
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");

type Mobile = {
  shot: string;
  header: { height: number; controls: Array<{ el: string; w: number; h: number }> } | null;
  counts: { controls: number };
  small: unknown[];
  smallFieldFont: unknown[];
  toggles: Array<{ el: string; w: number; h: number }>;
  tightCount: number;
  text: { medianPx: number; shareGe15: number; shareGe16: number };
  overflow: { scrollWidth: number; innerWidth: number; offenders: unknown[] };
  hiddenOverflow?: Array<{ el: string; client: number; scroll: number }>;
};
type Desktop = { shot: string; headerHeight: number | null; count: number; geometry: string[] };
type Results = { pages: Record<string, { path: string; "390": Mobile; "1440": Desktop }>; dialog?: Record<string, unknown>; consoleErrors: string[] };

const before = JSON.parse(fs.readFileSync(path.join(DIR, "results-before.json"), "utf8")) as Results;
const after = JSON.parse(fs.readFileSync(path.join(DIR, "results-after.json"), "utf8")) as Results;
// Повторная проверка 1440 с ожиданием покоя (desktop-recheck.ts compare).
const stablePath = path.join(DIR, "desktop-compare.json");
const stable = fs.existsSync(stablePath) ? (JSON.parse(fs.readFileSync(stablePath, "utf8")) as Record<string, unknown>) : null;

async function pixelDiff(a: string, b: string) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.evaluate("globalThis.__name = (f) => f");
    const out = await page.evaluate(
      async ([ua, ub]) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
          });
        const [ia, ib] = await Promise.all([load(ua), load(ub)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { sameSize: false, diff: -1, total: 0 };
        const read = (img: HTMLImageElement) => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height).data;
        };
        const da = read(ia);
        const db = read(ib);
        let diff = 0;
        for (let i = 0; i < da.length; i += 4) {
          if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) diff += 1;
        }
        return { sameSize: true, diff, total: da.length / 4 };
      },
      [
        `data:image/png;base64,${fs.readFileSync(a).toString("base64")}`,
        `data:image/png;base64,${fs.readFileSync(b).toString("base64")}`,
      ] as const
    );
    return out;
  } finally {
    await browser.close();
  }
}

async function main() {
  const pages: Record<string, unknown> = {};
  const ac1: string[] = [];
  const ac2: string[] = [];
  const ac3: string[] = [];
  const signals: string[] = [];
  for (const key of Object.keys(after.pages)) {
    const b = before.pages[key];
    const a = after.pages[key];
    const bm = b["390"];
    const am = a["390"];
    const bd = b["1440"];
    const ad = a["1440"];

    // AC3 — геометрия и пиксели 1440.
    const geomDiffs: string[] = [];
    const n = Math.max(bd.geometry.length, ad.geometry.length);
    for (let i = 0; i < n; i += 1) if (bd.geometry[i] !== ad.geometry[i]) geomDiffs.push(`#${i}: ${bd.geometry[i] ?? "—"} → ${ad.geometry[i] ?? "—"}`);
    const px = await pixelDiff(path.join(SHOTS, bd.shot), path.join(SHOTS, ad.shot));
    // Основной прогон снимает через 0.9 с после networkidle; если там есть
    // расхождения, решает повторная проверка с ожиданием покоя страницы
    // (desktop-recheck.ts): она сравнивает вёрстку, а не момент отрисовки
    // плавающего дока или графика.
    const recheck = stable?.[b.path] as { diffs: number; samplesBefore: number; samplesAfter: number } | undefined;
    const desktopSame =
      bd.headerHeight === ad.headerHeight && (geomDiffs.length === 0 || (recheck !== undefined && recheck.diffs === 0));
    if (!desktopSame) ac3.push(`${key}: ${geomDiffs.length} geometry diffs (header ${bd.headerHeight} → ${ad.headerHeight}), stable recheck: ${recheck ? recheck.diffs : "n/a"}`);
    else if (geomDiffs.length > 0) signals.push(`${key}: 1440 main run ${geomDiffs.length} diffs from render timing, stable recheck 0 diffs`);

    // AC1 — шапка 390 (кабинетные страницы; /master — своя шапка).
    const iconButtons = (am.header?.controls ?? []).filter((c) => !c.el.includes("на дашборд"));
    const smallIcons = iconButtons.filter((c) => c.w < 43.5 || c.h < 43.5);
    if (key !== "08-master") {
      if (!am.header || am.header.height < 52 || am.header.height > 56.5 || am.header.height >= (bm.header?.height ?? 0))
        ac1.push(`${key}: header ${bm.header?.height} → ${am.header?.height}`);
    } else if ((am.header?.height ?? 999) >= (bm.header?.height ?? 0)) {
      ac1.push(`${key}: master header not thinner ${bm.header?.height} → ${am.header?.height}`);
    }
    if (smallIcons.length) ac1.push(`${key}: header icons <44: ${JSON.stringify(smallIcons)}`);

    // AC2 — кнопки/поля 48, шрифт полей 16, без горизонтальной прокрутки
    // страницы (ширина документа и вылеты за край экрана).
    if (am.small.length || am.smallFieldFont.length || am.overflow.offenders.length || am.overflow.scrollWidth > am.overflow.innerWidth)
      ac2.push(
        `${key}: small=${am.small.length} fieldFont=${am.smallFieldFont.length} offenders=${am.overflow.offenders.length} scrollWidth=${am.overflow.scrollWidth}`
      );
    // Сигнал (не критерий): у прокрутчиков без таблиц спрятанного за краем
    // стало больше — например, вкладка уехала за край полосы вкладок.
    const hiddenPx = (list?: Array<{ client: number; scroll: number }>) => (list ?? []).reduce((sum, h) => sum + (h.scroll - h.client), 0);
    if (hiddenPx(am.hiddenOverflow) > hiddenPx(bm.hiddenOverflow) + 8)
      signals.push(`${key}: hidden overflow ${hiddenPx(bm.hiddenOverflow)}px → ${hiddenPx(am.hiddenOverflow)}px ${JSON.stringify(am.hiddenOverflow)}`);

    pages[key] = {
      path: b.path,
      shots: { before390: bm.shot, after390: am.shot, before1440: bd.shot, after1440: ad.shot },
      header390: { before: bm.header?.height, after: am.header?.height },
      headerIcons390After: iconButtons.map((c) => `${c.w}x${c.h}`),
      header1440: { before: bd.headerHeight, after: ad.headerHeight },
      controls390: { before: bm.counts.controls, after: am.counts.controls },
      below48: { before: bm.small.length, after: am.small.length },
      fieldFontBelow16: { before: bm.smallFieldFont.length, after: am.smallFieldFont.length },
      tightPairsBelow8: { before: bm.tightCount, after: am.tightCount },
      // Пары с плавающей кнопкой «Помощь и подсказки» (position: fixed) — это
      // наложение поверх строки в момент снимка, а не зазор между соседями.
      tightPairsExcludingFloatingDock: {
        before: ((bm as unknown as { tight: Array<{ a: string; b: string }> }).tight ?? []).filter((t) => !`${t.a}${t.b}`.includes("Помощь и подсказки")).length,
        after: ((am as unknown as { tight: Array<{ a: string; b: string }> }).tight ?? []).filter((t) => !`${t.a}${t.b}`.includes("Помощь и подсказки")).length,
        afterPairs: ((am as unknown as { tight: Array<{ a: string; b: string; gap: number }> }).tight ?? []),
      },
      toggles390After: am.toggles.slice(0, 3),
      textMedianPx: { before: bm.text.medianPx, after: am.text.medianPx },
      textShareGe15: { before: bm.text.shareGe15, after: am.text.shareGe15 },
      textShareGe16: { before: bm.text.shareGe16, after: am.text.shareGe16 },
      overflow390After: { scrollWidth: am.overflow.scrollWidth, offenders: am.overflow.offenders.length, hiddenOverflow: am.hiddenOverflow ?? [] },
      hiddenOverflow390Before: bm.hiddenOverflow ?? [],
      desktop1440: { elements: ad.geometry.length, geometryDiffs: geomDiffs.length, firstDiffs: geomDiffs.slice(0, 5), pixels: px },
    };
  }

  // Дополнительные страницы: сигналы регрессии (не часть восьми страниц AC).
  type Extra = Record<string, { path: string; finalUrl?: string; "390"?: Mobile & { error?: string }; "1440"?: Desktop & { error?: string } }>;
  const bx = ((before as unknown as { extra?: Extra }).extra ?? {}) as Extra;
  const axx = ((after as unknown as { extra?: Extra }).extra ?? {}) as Extra;
  const extra: Record<string, unknown> = {};
  const regressions: string[] = [];
  for (const key of Object.keys(axx)) {
    const b = bx[key];
    const a = axx[key];
    const bm = b?.["390"];
    const am = a?.["390"];
    const bd = b?.["1440"];
    const ad = a?.["1440"];
    const errors = [bm?.error, am?.error, bd?.error, ad?.error].filter(Boolean);
    const geomDiffs = bd?.geometry && ad?.geometry ? ad.geometry.filter((g, i) => g !== bd.geometry[i]).length + Math.abs(ad.geometry.length - bd.geometry.length) : null;
    const hiddenPxX = (list?: Array<{ client: number; scroll: number }>) => (list ?? []).reduce((sum, h) => sum + (h.scroll - h.client), 0);
    const newHidden = hiddenPxX(am?.hiddenOverflow) > hiddenPxX(bm?.hiddenOverflow) + 8 ? am?.hiddenOverflow ?? [] : [];
    const row = {
      path: a.path,
      finalUrl: a.finalUrl,
      below48: { before: bm?.small?.length, after: am?.small?.length },
      fieldFontBelow16: { before: bm?.smallFieldFont?.length, after: am?.smallFieldFont?.length },
      tight: { before: bm?.tightCount, after: am?.tightCount },
      textMedianPx: { before: bm?.text?.medianPx, after: am?.text?.medianPx },
      offendersAfter: am?.overflow?.offenders ?? [],
      newHiddenOverflow: newHidden,
      desktop1440GeometryDiffs: geomDiffs,
      errors,
    };
    extra[key] = row;
    if (errors.length || (am?.overflow?.offenders?.length ?? 0) > 0 || newHidden.length || geomDiffs !== 0)
      regressions.push(`${key} ${a.path}: offenders=${am?.overflow?.offenders?.length} newHidden=${JSON.stringify(newHidden)} geomDiffs=${geomDiffs} errors=${errors.join("; ")}`);
  }

  const dialog = after.dialog as { small?: unknown[]; smallFieldFont?: unknown[] } | undefined;
  if (dialog && ((dialog.small ?? []).length || (dialog.smallFieldFont ?? []).length)) ac2.push(`dialog: ${JSON.stringify(dialog)}`);

  const verdict = {
    AC1: ac1.length ? "FAIL" : "PASS",
    AC2: ac2.length ? "FAIL" : "PASS",
    AC3: ac3.length ? "FAIL" : "PASS",
    problems: { AC1: ac1, AC2: ac2, AC3: ac3 },
    signals,
  };
  const evidence = {
    task: "mobile-cabinet-2026-09",
    generatedAt: new Date().toISOString(),
    before: { at: (before as unknown as { at: string }).at },
    after: { at: (after as unknown as { at: string }).at },
    verdict,
    dialog390: { before: before.dialog ?? null, after: after.dialog ?? null },
    consoleErrors: { before: before.consoleErrors.length, after: after.consoleErrors.length },
    pages,
    extraPages: { note: "регрессионный обход: 390 и 1440 без скриншотов", regressions, rows: extra },
  };
  fs.writeFileSync(path.join(TASK, "evidence.json"), JSON.stringify(evidence, null, 2));

  // Сырьё для коммита: полные results-*.json весят по мегабайту из-за
  // геометрии 1440 — в «тонкой» копии массив заменён числом и SHA-1.
  const slim = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(slim);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] =
          k === "geometry" && Array.isArray(v)
            ? { count: v.length, sha1: createHash("sha1").update((v as string[]).join("\n")).digest("hex") }
            : slim(v);
      }
      return out;
    }
    return value;
  };
  fs.writeFileSync(path.join(DIR, "raw-before.json"), JSON.stringify(slim(before), null, 1));
  fs.writeFileSync(path.join(DIR, "raw-after.json"), JSON.stringify(slim(after), null, 1));
  for (const [key, p] of Object.entries(pages)) {
    const v = p as Record<string, Record<string, unknown>>;
    console.log(
      `${key.padEnd(15)} header390 ${v.header390.before}→${v.header390.after}  <48: ${v.below48.before}→${v.below48.after}  tight: ${v.tightPairsBelow8.before}→${v.tightPairsBelow8.after}  median ${v.textMedianPx.before}→${v.textMedianPx.after}  1440 geomDiffs=${v.desktop1440.geometryDiffs} px=${JSON.stringify(v.desktop1440.pixels)}`
    );
  }
  console.log(JSON.stringify(verdict, null, 1));
  console.log(`extra pages: ${Object.keys(extra).length}, regression signals: ${regressions.length}`);
  for (const line of regressions) console.log("  " + line);
  for (const [key, row] of Object.entries(extra)) {
    const r = row as Record<string, Record<string, unknown> | unknown>;
    const b48 = r.below48 as Record<string, unknown>;
    const tm = r.textMedianPx as Record<string, unknown>;
    console.log(`  ${key} ${String(r.path).padEnd(52)} <48 ${b48.before}→${b48.after}  median ${tm.before}→${tm.after}  1440diffs=${r.desktop1440GeometryDiffs}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
