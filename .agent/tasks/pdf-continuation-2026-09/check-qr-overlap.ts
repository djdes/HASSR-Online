/**
 * Автопроверка QR печатных журналов: ничего не перекрыто, QR на своём месте.
 *
 * Копия `journal-pdf-qr-2026-09/check-qr-overlap.ts` под компактную шапку
 * продолжений (`.agent/tasks/pdf-continuation-2026-09`, 2026-09-28): на
 * стр. 2..N в ячейке шапки — компактный код (коррекция M, без знака и полосы,
 * `placement.variant === "compact"`): модули сверяются с его матрицей, без
 * пропуска клеток под знаком; шапка страницы распознаётся по «СИСТЕМА ХАССП»
 * (полная) или по «СТР. X ИЗ N» в верхней части листа (компактная — там
 * «СИСТЕМА ХАССП» нет). Остальное — как было. Итог — в raw/ этой задачи.
 *
 * История: 2026-09-24 — маленький QR в правом нижнем углу; 2026-09-27 —
 * фирменный QR в шапке ХАССП справа (`.agent/tasks/journal-qr-header-2026-09`),
 * проверка переписана под новое место; 2026-09-27 (ч/б плитка,
 * `.agent/tasks/qr-bw-minimal-2026-09`) — в шапке плитка занимает всю ячейку
 * внутри линий (линии — рамка кода), модули считаются от окна кода
 * (`placement.window`), а не от угла плитки. Наборы бланков — из
 * `journal-qr-header-2026-09/pages.ts`: образцы 45 журналов, те же образцы как
 * скачанный шаблон (QR /qb + строка копирайта внизу), «длинные» документы
 * всех 45 журналов (QR документа /qj/…), 5 бумажных бланков, варианты
 * (гигиена по Приложению №1, подвал партнёра).
 *
 * Для каждого бланка — три рендера: без QR, «проба» (место под QR
 * посчитано и оставлено — ячейка в шапке, — но плитка и строка внизу не
 * нарисованы) и с QR. По каждой странице:
 *   1. растр пробы (300 dpi) на месте плитки — 0 тёмных пикселей (любой
 *      канал < 235): у ячейки шапки — ячейка внутри линий без 0,1 мм у них, у
 *      угла без шапки — плитка + 1 мм; строка внизу (шаблоны) — тоже пусто;
 *   2. растр с QR и растр пробы (100 dpi, вся страница) совпадают везде,
 *      кроме плитки и строки внизу: штамп больше ничего не тронул;
 *   3. модули в центрах клеток (растр 300 dpi) — ровно матрица адреса
 *      (коррекция H); клетки под знаком сайта пропускаются;
 *   0. на каждой странице с шапкой ХАССП (полная — текст «СИСТЕМА ХАССП»,
 *      компактная — «СТР. X ИЗ N» в верхней части листа) QR стоит в
 *      её ячейке, на странице без шапки — нет (бумажные бланки — без шапки ХАССП);
 *   4. QR в шапке — в ячейке шапки; правый край ячейки (рамка шапки) — вровень
 *      с правой границей содержимого страницы по растру пробы (≤ 0,5 мм),
 *      если таблица не шире листа; QR в углу страницы без шапки — правым
 *      краем вровень с той же границей;
 *   5. поля листа по растру (100 dpi): сверху, слева и справа — 10 ± 1 мм,
 *      снизу — не меньше 9 мм (QR больше не стоит на нижнем поле); у
 *      бумажных бланков поля только записываются — их вёрстка полей 10 мм
 *      не выравнивалась.
 * Страницы без шапки: QR в правом верхнем углу, если там пусто (`corner`),
 * иначе QR на странице нет (`none`) — такие страницы перечисляются.
 * Известные вылезания таблицы на шапку (ошибка вёрстки бланка, так же на
 * master) — `KNOWN_OVERFLOW`: там п. 1 не выполняется до штампа, а плитка
 * (поверх, с белым фоном) проверяется по модулям.
 *
 * Запуск (из корня репо):
 *   npx tsx .agent/tasks/journal-pdf-qr-2026-09/check-qr-overlap.ts <набор,набор> [метка,метка]
 *   наборы: samples | blanks | long | paper | variants
 * Переменные: QR_CHECK_OUT=<папка задачи> — куда писать raw/ (по умолчанию
 * journal-qr-header-2026-09).
 */
import fs from "node:fs";
import path from "node:path";

import { journalQrCompact, journalQrMatrix, type JournalQrPlacement, type PdfBox } from "@/lib/pdf-journal-qr";
import { brandQrLayout } from "@/lib/brand-qr";

import { buildCases, countPdfPages } from "../journal-qr-header-2026-09/pages";
import { openPdf, pageSizeMm, renderRegion, type Raster } from "../journal-qr-header-2026-09/qr-sim";

const TASK_DIR = process.env.QR_CHECK_OUT
  ? path.resolve(process.env.QR_CHECK_OUT)
  : path.join(process.cwd(), ".agent", "tasks", "pdf-continuation-2026-09");
const MARGIN = 10;
const MARGIN_TOL = 1;
/** Допуск «вровень», мм. */
const ALIGN_TOL = 0.5;
const PAGE_DPI = 100;
const QR_DPI = 300;
/** Зона непечати у края листа: таблица, что заходит за неё, — ошибка вёрстки бланка («шире листа»). */
const EDGE = 5;

/**
 * Известные вылезания таблицы на шапку (ошибка вёрстки самого бланка, не QR;
 * так же на master): там в ячейке QR ещё до штампа есть чужой текст. Плитка
 * рисуется последней, поверх, с белым фоном — её модули проверяются как у
 * всех; страница помечается `knownOverflow`.
 */
const KNOWN_OVERFLOW: Record<string, string> = {
  "long:cleaning_ventilation_checklist":
    "синтетика: 70 ответственных — строка блока «Процедура» выше листа; autoTable не делит строку с объединёнными " +
    "ячейками и печатает её продолжение поверх шапки стр. 2–4 (так же на master: pdf-top-margin-2026-09, «Замечания»)",
};

const dark = (d: Uint8ClampedArray, i: number) => Math.min(d[i], d[i + 1], d[i + 2]) < 235;

function inkIn(r: Raster, dpi: number, origin: { x: number; y: number }, box: PdfBox): number {
  const k = dpi / 25.4;
  let count = 0;
  const x0 = Math.max(0, Math.floor((box.x0 - origin.x) * k));
  const y0 = Math.max(0, Math.floor((box.y0 - origin.y) * k));
  const x1 = Math.min(r.width, Math.ceil((box.x1 - origin.x) * k));
  const y1 = Math.min(r.height, Math.ceil((box.y1 - origin.y) * k));
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (dark(r.data, (y * r.width + x) * 4)) count += 1;
  return count;
}

/** Поля по растру всей страницы и правая граница содержимого, мм. */
function inkFrame(r: Raster, dpi: number) {
  const k = dpi / 25.4;
  let x0 = r.width;
  let x1 = -1;
  let y0 = r.height;
  let y1 = -1;
  for (let y = 0; y < r.height; y += 1) {
    for (let x = 0; x < r.width; x += 1) {
      if (!dark(r.data, (y * r.width + x) * 4)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { left: x0 / k, right: (x1 + 1) / k, top: y0 / k, bottom: (y1 + 1) / k };
}

/** Пиксели, где растр с QR отличается от пробы вне разрешённых прямоугольников. */
function diffOutside(a: Raster, b: Raster, dpi: number, allowed: PdfBox[]): number {
  const k = dpi / 25.4;
  let count = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) < 24) continue;
      const mx = (x + 0.5) / k;
      const my = (y + 0.5) / k;
      if (allowed.some((box) => mx >= box.x0 && mx <= box.x1 && my >= box.y0 && my <= box.y1)) continue;
      count += 1;
    }
  }
  return count;
}

function moduleMismatches(r: Raster, dpi: number, origin: { x: number; y: number }, p: JournalQrPlacement, url: string): number {
  if (p.variant === "compact") return compactModuleMismatches(r, dpi, origin, p, url);
  const layout = brandQrLayout(url);
  const qr = journalQrMatrix(url);
  const k = dpi / 25.4;
  const pad = layout.pad;
  const win = p.window!;
  let bad = 0;
  for (let row = 0; row < layout.size; row += 1) {
    for (let col = 0; col < layout.size; col += 1) {
      const mx = layout.window.x + layout.quiet + col + 0.5;
      const my = layout.window.y + layout.quiet + row + 0.5;
      if (mx >= pad.x && mx <= pad.x + pad.w && my >= pad.y && my <= pad.y + pad.h) continue;
      const cx = (win.x0 + (layout.quiet + col + 0.5) * p.module - origin.x) * k;
      const cy = (win.y0 + (layout.quiet + row + 0.5) * p.module - origin.y) * k;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = Math.min(r.width - 1, Math.max(0, Math.floor(cx) + dx));
          const y = Math.min(r.height - 1, Math.max(0, Math.floor(cy) + dy));
          const i = (y * r.width + x) * 4;
          sum += (r.data[i] + r.data[i + 1] + r.data[i + 2]) / 3;
        }
      }
      if (sum / 9 < 128 !== Boolean(qr.modules.get(row, col))) bad += 1;
    }
  }
  return bad;
}

/** Компактный код продолжения: матрица с коррекцией M, знака нет — сверяются все клетки. */
function compactModuleMismatches(r: Raster, dpi: number, origin: { x: number; y: number }, p: JournalQrPlacement, url: string): number {
  const compact = journalQrCompact(url);
  const k = dpi / 25.4;
  const win = p.window!;
  const quiet = 2;
  let bad = 0;
  for (let row = 0; row < compact.modules; row += 1) {
    for (let col = 0; col < compact.modules; col += 1) {
      const cx = (win.x0 + (quiet + col + 0.5) * p.module - origin.x) * k;
      const cy = (win.y0 + (quiet + row + 0.5) * p.module - origin.y) * k;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = Math.min(r.width - 1, Math.max(0, Math.floor(cx) + dx));
          const y = Math.min(r.height - 1, Math.max(0, Math.floor(cy) + dy));
          const i = (y * r.width + x) * 4;
          sum += (r.data[i] + r.data[i + 1] + r.data[i + 2]) / 3;
        }
      }
      if (sum / 9 < 128 !== Boolean(compact.matrix.modules.get(row, col))) bad += 1;
    }
  }
  return bad;
}

type PageResult = {
  page: number;
  where: JournalQrPlacement["where"];
  variant: JournalQrPlacement["variant"];
  box: PdfBox | null;
  slot: PdfBox | null;
  /** На странице есть шапка ХАССП (полная или компактная); должно совпасть с `where === "header"`. */
  hasHeader: boolean;
  modules: number;
  moduleMm: number;
  /** Тёмных пикселей пробы на месте плитки (и строки внизу). */
  inkBeforeStamp: number;
  /** Известное вылезание таблицы на шапку (причина) — см. KNOWN_OVERFLOW. */
  knownOverflow: string | null;
  /** Пикселей, изменённых штампом вне плитки и строки внизу. */
  changedOutside: number;
  moduleMismatches: number;
  /** Правая граница содержимого страницы по растру пробы, мм. */
  contentRightMm: number | null;
  /** Правый край ячейки QR (шапка) или плитки (угол), мм. */
  qrRightMm: number | null;
  alignDiffMm: number | null;
  overflowSheet: boolean;
  margins: { top: number; bottom: number; left: number; right: number } | null;
  marginsOk: boolean;
  ok: boolean;
};

type CaseResult = {
  set: string;
  label: string;
  url: string;
  modules: number;
  pagesPlain: number;
  pages: number;
  pagesHeader: number;
  pagesCorner: number;
  pagesNone: number;
  results: PageResult[];
  ok: boolean;
};

async function checkCase(item: ReturnType<typeof buildCases>[number]): Promise<CaseResult> {
  const plain = item.render("plain");
  const probe = item.render("probe");
  const stamp = item.render("stamp");
  const placements = (stamp.qrPlacements ?? []) as JournalQrPlacement[];
  const probePlacements = (probe.qrPlacements ?? []) as JournalQrPlacement[];
  const probeDoc = await openPdf(probe.buffer);
  const stampDoc = await openPdf(stamp.buffer);
  if (probeDoc.numPages !== stampDoc.numPages || placements.length !== stampDoc.numPages) {
    throw new Error(`${item.set}:${item.label}: страниц проба ${probeDoc.numPages}, с QR ${stampDoc.numPages}, мест ${placements.length}`);
  }
  const results: PageResult[] = [];
  for (let index = 0; index < placements.length; index += 1) {
    const p = placements[index];
    const pageNo = index + 1;
    const size = await pageSizeMm(stampDoc, pageNo);
    const whole = { x0: 0, y0: 0, x1: size.width, y1: size.height };
    const probePage = await renderRegion(probeDoc, pageNo, whole, PAGE_DPI);
    const stampPage = await renderRegion(stampDoc, pageNo, whole, PAGE_DPI);
    const frame = inkFrame(probePage, PAGE_DPI);
    const stampFrame = inkFrame(stampPage, PAGE_DPI);
    const samePlace = JSON.stringify(probePlacements[index]?.box) === JSON.stringify(p.box);
    // Строка внизу (копирайт шаблона) — слева на нижнем поле.
    const footerBox = { x0: MARGIN - 0.5, y0: size.height - MARGIN - 2.6, x1: size.width / 2 + 40, y1: size.height - MARGIN + 1 };
    const allowed: PdfBox[] = [footerBox];
    let inkBefore = 0;
    let mismatches = 0;
    if (p.box) {
      const b = p.box;
      allowed.push({ x0: b.x0 - 0.3, y0: b.y0 - 0.3, x1: b.x1 + 0.3, y1: b.y1 + 0.3 });
      const zone = p.where === "header" ? { x0: b.x0 + 0.1, y0: b.y0 + 0.1, x1: b.x1 - 0.1, y1: b.y1 - 0.1 } : { x0: b.x0 - 1, y0: b.y0 - 1, x1: b.x1 + 1, y1: b.y1 + 1 };
      // Начало кадра — по сетке пикселей листа (renderRegion округляет так же).
      const k = QR_DPI / 25.4;
      const origin = { x: Math.floor((zone.x0 - 2) * k + 1e-6) / k, y: Math.floor((zone.y0 - 2) * k + 1e-6) / k };
      const probeZone = await renderRegion(probeDoc, pageNo, { x0: origin.x, y0: origin.y, x1: zone.x1 + 2, y1: zone.y1 + 2 }, QR_DPI);
      inkBefore += inkIn(probeZone, QR_DPI, origin, zone);
      const stampZone = await renderRegion(stampDoc, pageNo, { x0: origin.x, y0: origin.y, x1: zone.x1 + 2, y1: zone.y1 + 2 }, QR_DPI);
      mismatches = moduleMismatches(stampZone, QR_DPI, origin, p, item.url);
    }
    // Строка внизу (у шаблонов /qb): в пробе на её месте пусто.
    if (item.set === "blanks" || item.set === "paper") inkBefore += inkIn(probePage, PAGE_DPI, { x: 0, y: 0 }, footerBox);
    const changedOutside = diffOutside(stampPage, probePage, PAGE_DPI, allowed);
    const contentRight = frame ? frame.right : null;
    const overflowSheet = contentRight !== null && contentRight > size.width - EDGE + 0.3;
    const qrRight = p.where === "header" ? p.slot!.x1 : p.box ? p.box.x1 : null;
    // Правая рамка шапки — линия 0,2 мм по центру на x1: растр видит её край на x1 + 0,1.
    const alignDiff =
      qrRight === null || contentRight === null || overflowSheet
        ? null
        : Math.abs(contentRight - (qrRight + (p.where === "header" ? 0.1 : 0)));
    const m = stampFrame
      ? { top: stampFrame.top, bottom: size.height - stampFrame.bottom, left: stampFrame.left, right: size.width - stampFrame.right }
      : null;
    // Бумажные бланки (`paper-journal-pdf.ts`) поля листа 10 мм не
    // выравнивали (продолжение таблицы — с 14,1 мм, поле autoTable): их поля
    // только записываются.
    const marginsOk =
      !m ||
      overflowSheet ||
      item.set === "paper" ||
      (Math.abs(m.top - MARGIN) <= MARGIN_TOL &&
        Math.abs(m.left - MARGIN) <= MARGIN_TOL &&
        Math.abs(m.right - MARGIN) <= MARGIN_TOL &&
        m.bottom >= MARGIN - MARGIN_TOL);
    const knownOverflow = inkBefore > 0 && `${item.set}:${item.label}` in KNOWN_OVERFLOW;
    // Шапка ХАССП на странице есть ⇔ QR в её ячейке (у бумажных бланков
    // шапки ХАССП нет — QR в их собственном заголовке, «угол»).
    const text = await (await stampDoc.getPage(pageNo)).getTextContent();
    const items = text.items as Array<{ str?: string; transform?: number[] }>;
    const pageHeightPt = (size.height / 25.4) * 72;
    const hasHeader = items.some(
      (t) =>
        (t.str ?? "").includes("СИСТЕМА ХАССП") ||
        // Компактная шапка: «СТР. X ИЗ N» в верхней части листа (без шапки
        // подпись страницы — у нижнего поля).
        (/^СТР\. \d+ ИЗ \d+$/.test((t.str ?? "").trim()) && !!t.transform && ((pageHeightPt - t.transform[5]) / 72) * 25.4 < 60),
    );
    const headerMatches = item.set === "paper" || hasHeader === (p.where === "header");
    const ok =
      samePlace &&
      headerMatches &&
      (inkBefore === 0 || knownOverflow) &&
      changedOutside === 0 &&
      mismatches === 0 &&
      (alignDiff === null || alignDiff <= ALIGN_TOL) &&
      marginsOk &&
      (p.where !== "header" || !!p.slot);
    results.push({
      page: pageNo,
      where: p.where,
      variant: p.variant,
      box: p.box,
      slot: p.slot,
      hasHeader,
      modules: p.modules,
      moduleMm: +p.module.toFixed(4),
      inkBeforeStamp: inkBefore,
      knownOverflow: knownOverflow ? KNOWN_OVERFLOW[`${item.set}:${item.label}`] : null,
      changedOutside,
      moduleMismatches: mismatches,
      contentRightMm: contentRight === null ? null : +contentRight.toFixed(2),
      qrRightMm: qrRight === null ? null : +qrRight.toFixed(2),
      alignDiffMm: alignDiff === null ? null : +alignDiff.toFixed(2),
      overflowSheet,
      margins: m && {
        top: +m.top.toFixed(1),
        bottom: +m.bottom.toFixed(1),
        left: +m.left.toFixed(1),
        right: +m.right.toFixed(1),
      },
      marginsOk,
      ok,
    });
  }
  await probeDoc.close();
  await stampDoc.close();
  return {
    set: item.set,
    label: item.label,
    url: item.url,
    modules: placements[0]?.modules ?? 0,
    pagesPlain: countPdfPages(plain.buffer),
    pages: placements.length,
    pagesHeader: results.filter((r) => r.where === "header").length,
    pagesCorner: results.filter((r) => r.where === "corner").length,
    pagesNone: results.filter((r) => r.where === "none").length,
    results,
    ok: results.every((r) => r.ok),
  };
}

async function main() {
  const [setsArg, labelsArg] = process.argv.slice(2);
  const sets = new Set((setsArg ?? "samples").split(","));
  const labels = labelsArg ? new Set(labelsArg.split(",")) : null;
  const all: CaseResult[] = [];
  for (const item of buildCases(sets)) {
    if (labels && !labels.has(item.label)) continue;
    const started = Date.now();
    const r = await checkCase(item);
    all.push(r);
    const bad = r.results.filter((p) => !p.ok);
    const align = r.results.map((p) => p.alignDiffMm).filter((v): v is number => v !== null);
    console.log(
      `${r.ok ? "OK  " : "FAIL"} ${r.set.padEnd(8)} ${r.label.padEnd(34)} n=${r.modules} стр. ${r.pagesPlain}→${r.pages} ` +
        `шапка ${r.pagesHeader} угол ${r.pagesCorner} нет ${r.pagesNone} ` +
        `ink=${Math.max(0, ...r.results.map((p) => p.inkBeforeStamp))} diff=${Math.max(0, ...r.results.map((p) => p.changedOutside))} ` +
        `mism=${Math.max(0, ...r.results.map((p) => p.moduleMismatches))} align≤${align.length ? Math.max(...align).toFixed(2) : "-"} ` +
        `${bad.length ? `плохие стр.: ${bad.map((p) => p.page).join(",")} ` : ""}${Date.now() - started} мс`,
    );
  }
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  const name = `check-overlap-${[...sets].join("+")}${labels ? `-${[...labels].join("+")}` : ""}.json`;
  fs.writeFileSync(path.join(TASK_DIR, "raw", name), JSON.stringify(all, null, 1));
  const pages = all.flatMap((c) => c.results);
  const none = all.flatMap((c) => c.results.filter((p) => p.where === "none").map((p) => `${c.set}:${c.label} стр. ${p.page}`));
  const overflow = all.flatMap((c) => c.results.filter((p) => p.knownOverflow).map((p) => `${c.set}:${c.label} стр. ${p.page}`));
  if (overflow.length) console.log(`\nизвестное вылезание таблицы на шапку (не QR, так же на master): ${overflow.join(", ")}`);
  console.log(
    `\n${all.filter((c) => c.ok).length}/${all.length} бланков OK, страниц ${pages.length}: ` +
      `в шапке ${pages.filter((p) => p.where === "header").length}, в углу без шапки ${pages.filter((p) => p.where === "corner").length}, ` +
      `без QR (нет шапки, угол занят) ${none.length}`,
  );
  process.exit(all.every((c) => c.ok) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
