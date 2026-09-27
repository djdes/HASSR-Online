/**
 * Автопроверка QR в углу печатных журналов (AC1–AC3).
 *
 * Для каждого журнала:
 *   1. рендер БЕЗ QR (как было) — число страниц «до»;
 *   2. рендер probe (место под QR зарезервировано и посчитано, но QR не
 *      нарисован) → растр 200 dpi → «чернила» в прямоугольнике QR+подпись
 *      (+1 мм поля) на каждой странице. Должно быть 0 тёмных пикселей;
 *   3. рендер С QR → растр → (а) модули матрицы в центрах клеток сверяются с
 *      `QRCode.create(url)`; (б) независимое декодирование jsQR (если путь к
 *      нему передан в QR_DECODER) — строка должна совпасть с адресом;
 *   4. (с 2026-09-24) выравнивание: правый край QR против правой границы
 *      содержимого страницы, измеренной по растру пробы (самый правый тёмный
 *      пиксель страницы БЕЗ QR, т. е. правый край таблицы / рамки бланка).
 *      Разница должна быть ≤ 0,5 мм. Если содержимое заходит в зону
 *      непечати у края листа (таблица шире листа — ошибка вёрстки самого
 *      бланка), страница помечается `overflowSheet` и в метрику не входит:
 *      QR там равняется на то, что на листе целиком (рамку шапки).
 *      Если угол у границы занят и QR сдвинут влево (`shiftedLeft`: правый
 *      край QR левее своей границы) — это разрешённый спекой сдвиг «при
 *      занятости», такие страницы перечисляются отдельно. «СТР. X ИЗ N» и
 *      подвал партнёра стоят левее QR и в растре пробы видны — они тоже
 *      проверяются на наложение зоной пункта 2.
 *      (с 2026-09-27) Страница без таблицы и шапки — только строки у левого
 *      поля (продолжение списка подписей): QR по правилу штампа
 *      (`journalQrContentRight`: содержимое только в левой половине листа)
 *      встаёт на правое поле листа, а правее всего в растре пробы — «СТР. X
 *      ИЗ N», поставленная левее QR после расчёта его места. Метрика к такой
 *      странице неприменима (`defaultEdge`), страницы перечисляются отдельно.
 *
 * Запуск (из корня репо):
 *   npx tsx .agent/tasks/journal-pdf-qr-2026-09/check-qr-overlap.ts samples
 *   npx tsx .agent/tasks/journal-pdf-qr-2026-09/check-qr-overlap.ts docs <orgId> <docId,docId,...>
 * Переменные: QR_DECODER=<путь к jsqr>, SHOTS=<код,код,...> — какие углы сохранить в shots/,
 * QR_CHECK_OUT=<папка задачи> — куда писать raw/ и shots/ (по умолчанию эта папка),
 * QR_BRANDING=1 — печатать с подвалом партнёра (white-label) на каждой странице
 * (файлы с суффиксом `-partner`): подвал виден в растре пробы и проверяется зоной.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";

import {
  loadJournalDocumentPdfInput,
  renderJournalDocumentPdf,
  type JournalDocumentPdfInput,
} from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { journalPdfQrOrigin, journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { SAMPLE_JOURNAL_CODES, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import {
  JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM,
  JOURNAL_QR_EDGE_MM,
  journalQrMatrix,
  type JournalQrPlacement,
} from "@/lib/pdf-journal-qr";

const DPI = 200;
const PX_PER_MM = DPI / 25.4;
const TASK_DIR = process.env.QR_CHECK_OUT
  ? path.resolve(process.env.QR_CHECK_OUT)
  : path.join(process.cwd(), ".agent", "tasks", "journal-pdf-qr-2026-09");
const PARTNER = process.env.QR_BRANDING === "1";
const SUFFIX = PARTNER ? "-partner" : "";
const PARTNER_BRANDING = {
  brandName: "Партнёр Тест",
  pdfSignature:
    "Сопровождение и настройка журналов: ООО «Очень Длинное Название Партнёра по Внедрению ХАССП», тел. +7 900 000-00-00",
};
/** Допуск «QR вровень с таблицей», мм. */
const ALIGN_TOLERANCE_MM = 0.5;
const SHOTS_DIR = path.join(TASK_DIR, "shots");
const RAW_DIR = path.join(TASK_DIR, "raw");

type Raster = { width: number; height: number; data: Uint8ClampedArray; widthMm: number; heightMm: number };

async function rasterize(pdf: Buffer): Promise<Raster[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const out: Raster[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 }); // 1 unit = 1 pt
      const viewport = page.getViewport({ scale: DPI / 72 });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<
        typeof page.render
      >[0]).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      out.push({
        width: canvas.width,
        height: canvas.height,
        data: img.data,
        widthMm: (base.width / 72) * 25.4,
        heightMm: (base.height / 72) * 25.4,
      });
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/**
 * Модуль тёмный, если средняя яркость пикселей в его центре < 128.
 * При 200 dpi модуль 41-модульного кода — 2,5 px: одиночный пиксель на
 * границе модуля серый от сглаживания, поэтому берём среднее 3×3.
 */
function darkAt(r: Raster, px: number, py: number): boolean {
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = Math.min(r.width - 1, Math.max(0, Math.floor(px) + dx));
      const y = Math.min(r.height - 1, Math.max(0, Math.floor(py) + dy));
      const i = (y * r.width + x) * 4;
      sum += (r.data[i] + r.data[i + 1] + r.data[i + 2]) / 3;
      n += 1;
    }
  }
  return sum / n < 128;
}

/** Тёмные пиксели (любой канал < 235) в прямоугольнике, мм. */
function inkInBox(r: Raster, box: { x0: number; y0: number; x1: number; y1: number }): number {
  let count = 0;
  const x0 = Math.max(0, Math.floor(box.x0 * PX_PER_MM));
  const y0 = Math.max(0, Math.floor(box.y0 * PX_PER_MM));
  const x1 = Math.min(r.width, Math.ceil(box.x1 * PX_PER_MM));
  const y1 = Math.min(r.height, Math.ceil(box.y1 * PX_PER_MM));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * r.width + x) * 4;
      if (Math.min(r.data[i], r.data[i + 1], r.data[i + 2]) < 235) count += 1;
    }
  }
  return count;
}

/**
 * Правая граница содержимого страницы по растру, мм: правый край самого
 * правого столбца с тёмным пикселем (< 235). `null` — страница пустая.
 */
function inkRightMm(r: Raster): number | null {
  for (let x = r.width - 1; x >= 0; x -= 1) {
    for (let y = 0; y < r.height; y += 1) {
      const i = (y * r.width + x) * 4;
      if (Math.min(r.data[i], r.data[i + 1], r.data[i + 2]) < 235) return (x + 1) / PX_PER_MM;
    }
  }
  return null;
}

function moduleMismatches(r: Raster, p: JournalQrPlacement, url: string): number {
  const qr = journalQrMatrix(url);
  const n = qr.modules.size;
  const cell = p.size / n;
  let bad = 0;
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      const cx = (p.x + (col + 0.5) * cell) * PX_PER_MM;
      const cy = (p.y + (row + 0.5) * cell) * PX_PER_MM;
      if (darkAt(r, cx, cy) !== Boolean(qr.modules.get(row, col))) bad += 1;
    }
  }
  return bad;
}

type JsQr = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
const decoder: JsQr | null = process.env.QR_DECODER
  ? (createRequire(__filename)(process.env.QR_DECODER) as { default?: JsQr } & JsQr).default ??
    (createRequire(__filename)(process.env.QR_DECODER) as JsQr)
  : null;

function decode(r: Raster, p: JournalQrPlacement): string | null {
  if (!decoder) return null;
  const margin = 3; // мм белого вокруг — тихая зона для декодера
  const x0 = Math.max(0, Math.floor((p.x - margin) * PX_PER_MM));
  const y0 = Math.max(0, Math.floor((p.y - margin) * PX_PER_MM));
  const x1 = Math.min(r.width, Math.ceil((p.x + p.size + margin) * PX_PER_MM));
  const y1 = Math.min(r.height, Math.ceil((p.y + p.size + margin) * PX_PER_MM));
  const w = x1 - x0;
  const h = y1 - y0;
  const crop = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const from = ((y0 + y) * r.width + x0) * 4;
    crop.set(r.data.subarray(from, from + w * 4), y * w * 4);
  }
  // Кроп — только QR + 3 мм вокруг: подпись слева в него не попадает.
  return decoder(crop, w, h)?.data ?? null;
}

async function saveCorner(r: Raster, name: string, p: JournalQrPlacement) {
  // Правый нижний угол листа: 110×80 мм (видно QR, подпись и край таблицы).
  const wMm = 110;
  const hMm = 80;
  // Правый край кадра — 8 мм правее QR (у узких таблиц QR не у края листа).
  const x0 = Math.max(0, Math.round((Math.min(r.widthMm, p.x + p.size + 8) - wMm) * PX_PER_MM));
  const y0 = Math.max(0, Math.round((Math.min(r.heightMm, p.y + p.size + JOURNAL_QR_EDGE_MM) - hMm) * PX_PER_MM));
  const w = Math.min(r.width - x0, Math.round(wMm * PX_PER_MM));
  const h = Math.min(r.height - y0, Math.round(hMm * PX_PER_MM));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    const from = ((y0 + y) * r.width + x0) * 4;
    img.data.set(r.data.subarray(from, from + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOTS_DIR, name), canvas.toBuffer("image/png"));
}

type PageResult = {
  page: number;
  orientation: "portrait" | "landscape";
  qr: { x: number; y: number; size: number; modules: number; moved: boolean; bottomRow: boolean; overlap: boolean };
  inkInZoneBeforeStamp: number;
  /** Правый край QR, мм. */
  qrRightMm: number;
  /** Правая граница содержимого страницы без QR (растр пробы), мм. */
  contentRightMm: number | null;
  /** |QR − граница|, мм; null — на странице нет содержимого. */
  alignDiffMm: number | null;
  /** Содержимое заходит за край листа (зона непечати) — метрика не применима. */
  overflowSheet: boolean;
  /** Угол у границы занят — QR сдвинут влево по свободному месту. */
  shiftedLeft: boolean;
  /**
   * На странице нет таблицы и шапки справа (только строки у левого поля) —
   * QR стоит на правом поле листа по умолчанию; метрика не применима.
   */
  defaultEdge: boolean;
  /** Граница, по которой равнялся штамп (трекер), мм. */
  stampRightEdgeMm: number;
  /** QR вровень с границей (≤ 0,5 мм); страница без содержимого или overflowSheet — null. */
  aligned: boolean | null;
  moduleMismatches: number;
  decoded: string | null;
  decodedOk: boolean | null;
};

type JournalResult = {
  label: string;
  code: string;
  url: string;
  pagesWithoutQr: number;
  pagesWithQr: number;
  pages: PageResult[];
  ok: boolean;
};

async function checkOne(label: string, input: JournalDocumentPdfInput, shotName: string | null): Promise<JournalResult> {
  if (!input.qr) throw new Error(`${label}: нет qr во входе`);
  const url = input.qr.url;
  const plain = renderJournalDocumentPdf({ ...input, qr: null });
  const probe = renderJournalDocumentPdf({ ...input, qr: { ...input.qr, probeOnly: true } });
  const stamped = renderJournalDocumentPdf(input);
  const plainPages = (await rasterize(plain.buffer)).length;
  const probeRasters = await rasterize(probe.buffer);
  const stampedRasters = await rasterize(stamped.buffer);
  const placements = stamped.qrPlacements ?? [];
  const probePlacements = probe.qrPlacements ?? [];
  if (placements.length !== stampedRasters.length) throw new Error(`${label}: QR не на всех страницах`);
  // Проба обязана поставить QR туда же, что и настоящий штамп.
  const samePlaces =
    probePlacements.length === placements.length &&
    probePlacements.every((p, i) => Math.abs(p.x - placements[i].x) < 1e-6 && Math.abs(p.y - placements[i].y) < 1e-6);

  const pages: PageResult[] = placements.map((p, index) => {
    const probeP = probePlacements[index];
    const zone = { x0: probeP.block.x0 - 1, y0: probeP.block.y0 - 1, x1: probeP.block.x1 + 1, y1: probeP.block.y1 + 1 };
    const r = stampedRasters[index];
    const decoded = decode(r, p);
    const qrRight = p.x + p.size;
    const contentRight = inkRightMm(probeRasters[index]);
    const overflowSheet = contentRight !== null && contentRight > r.widthMm - JOURNAL_QR_EDGE_MM + 0.3;
    const shiftedLeft = qrRight < p.rightEdge - 0.05;
    const defaultEdge =
      Math.abs(p.rightEdge - (r.widthMm - JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM)) < 0.05 &&
      contentRight !== null &&
      contentRight < qrRight - ALIGN_TOLERANCE_MM;
    const alignDiff = contentRight === null ? null : Math.abs(qrRight - contentRight);
    return {
      page: p.page,
      orientation: r.widthMm > r.heightMm ? "landscape" : "portrait",
      qr: { x: +p.x.toFixed(1), y: +p.y.toFixed(1), size: p.size, modules: p.modules, moved: p.moved, bottomRow: p.bottomRow, overlap: p.overlap },
      inkInZoneBeforeStamp: inkInBox(probeRasters[index], zone),
      qrRightMm: +qrRight.toFixed(2),
      contentRightMm: contentRight === null ? null : +contentRight.toFixed(2),
      alignDiffMm: alignDiff === null ? null : +alignDiff.toFixed(2),
      overflowSheet,
      shiftedLeft,
      defaultEdge,
      stampRightEdgeMm: +p.rightEdge.toFixed(2),
      aligned:
        alignDiff === null || overflowSheet || shiftedLeft || defaultEdge ? null : alignDiff <= ALIGN_TOLERANCE_MM,
      moduleMismatches: moduleMismatches(r, p, url),
      decoded,
      decodedOk: decoder ? decoded === url : null,
    };
  });
  if (shotName && placements[0]) {
    const last = placements.length - 1;
    await saveCorner(stampedRasters[0], `${shotName}-p1.png`, placements[0]);
    if (last > 0) await saveCorner(stampedRasters[last], `${shotName}-p${last + 1}.png`, placements[last]);
  }
  const ok = samePlaces && pages.every(
    (p) =>
      p.inkInZoneBeforeStamp === 0 &&
      p.moduleMismatches === 0 &&
      !p.qr.overlap &&
      p.decodedOk !== false &&
      p.aligned !== false,
  );
  return {
    label,
    code: input.document.template.code,
    url,
    pagesWithoutQr: plainPages,
    pagesWithQr: stampedRasters.length,
    pages,
    ok,
  };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const shots = new Set((process.env.SHOTS ?? "").split(",").filter(Boolean));
  const results: JournalResult[] = [];
  if (mode === "samples") {
    const origin = journalPdfQrOrigin();
    const only = args[0] ? new Set(args[0].split(",")) : null;
    for (const code of SAMPLE_JOURNAL_CODES) {
      if (only && !only.has(code)) continue;
      const input = {
        ...buildJournalSampleInput(code),
        qr: journalSamplePdfQr(origin, code),
        ...(PARTNER ? { branding: PARTNER_BRANDING } : {}),
      };
      const started = Date.now();
      const result = await checkOne(`sample:${code}`, input, shots.has(code) ? `sample-${code}${SUFFIX}` : null);
      results.push(result);
      console.log(
        `${result.ok ? "OK  " : "FAIL"} ${code.padEnd(34)} pages ${result.pagesWithoutQr}→${result.pagesWithQr} ` +
          `ink=${result.pages.map((p) => p.inkInZoneBeforeStamp).join("/")} ` +
          `moved=${result.pages.filter((p) => p.qr.moved).length} up=${result.pages.filter((p) => !p.qr.bottomRow).length} mism=${result.pages.map((p) => p.moduleMismatches).join("/")} ` +
          `dec=${result.pages.map((p) => (p.decodedOk === null ? "-" : p.decodedOk ? "y" : "N")).join("")} ` +
          `align=${result.pages.map((p) => (p.alignDiffMm === null ? "-" : p.alignDiffMm.toFixed(2))).join("/")} ${Date.now() - started}ms`,
      );
    }
  } else if (mode === "docs") {
    const [organizationId, ids] = args;
    for (const documentId of (ids ?? "").split(",").filter(Boolean)) {
      const loaded = await loadJournalDocumentPdfInput({ documentId, organizationId });
      const input = PARTNER ? { ...loaded, branding: PARTNER_BRANDING } : loaded;
      const code = input.document.template.code;
      const result = await checkOne(`doc:${code}:${documentId}`, input, shots.has(code) ? `doc-${code}${SUFFIX}` : null);
      results.push(result);
      console.log(
        `${result.ok ? "OK  " : "FAIL"} ${code.padEnd(34)} rows=${input.document.entries.length} pages ${result.pagesWithoutQr}→${result.pagesWithQr} ` +
          `ink=${result.pages.map((p) => p.inkInZoneBeforeStamp).join("/")} moved=${result.pages.filter((p) => p.qr.moved).length} up=${result.pages.filter((p) => !p.qr.bottomRow).length} ` +
          `mism=${result.pages.map((p) => p.moduleMismatches).join("/")} dec=${result.pages.map((p) => (p.decodedOk === null ? "-" : p.decodedOk ? "y" : "N")).join("")} ` +
          `align=${result.pages.map((p) => (p.alignDiffMm === null ? "-" : p.alignDiffMm.toFixed(2))).join("/")}`,
      );
    }
  } else {
    throw new Error("режим: samples | docs <orgId> <ids>");
  }
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, `check-${mode}${SUFFIX}.json`), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  const allPages = results.flatMap((r) => r.pages);
  const measured = allPages.filter((p) => p.aligned !== null);
  const shifted = results.flatMap((r) =>
    r.pages.filter((p) => p.shiftedLeft && !p.overflowSheet).map((p) => `${r.code} стр. ${p.page}`),
  );
  const overflow = results.flatMap((r) => r.pages.filter((p) => p.overflowSheet).map((p) => `${r.code} стр. ${p.page}`));
  const textOnly = results.flatMap((r) =>
    r.pages.filter((p) => p.defaultEdge && !p.overflowSheet).map((p) => `${r.code} стр. ${p.page}`),
  );
  const maxDiff = measured.reduce((m, p) => Math.max(m, p.alignDiffMm ?? 0), 0);
  console.log(
    `
выравнивание: ${measured.filter((p) => p.aligned).length}/${measured.length} страниц вровень ` +
      `(≤ ${ALIGN_TOLERANCE_MM} мм), макс. разница ${maxDiff.toFixed(2)} мм; ` +
      `пустых страниц ${allPages.filter((p) => p.contentRightMm === null).length}; ` +
      `таблица за краем листа (метрика не применима): ${overflow.length ? overflow.join(", ") : "нет"}; ` +
      `QR сдвинут влево (угол занят): ${shifted.length ? shifted.join(", ") : "нет"}; ` +
      `QR на правом поле листа (на странице только строки у левого поля): ${textOnly.length ? textOnly.join(", ") : "нет"}`,
  );
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
