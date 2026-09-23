import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

/**
 * Геометрия превью журнала.
 *
 * 2026-09-07: было 1228×862 PNG — ровно как образцы в
 * `public/journal-samples`. На /journals таких карточек 30-40 штук, и
 * средний снимок весил 145 КБ (замер по продовой `JournalPreview`:
 * 645 строк, 89 МБ) — то есть страница тянула ~5 МБ картинок. На
 * телефоне они забивали HTTP/2-соединение, и переход в сам журнал
 * ждал своей очереди за ними: отсюда «картинки грузятся долго, а
 * потом и журнал долго открывается».
 *
 * Карточка рисует превью шириной ~180-280 CSS-px, поэтому 768 хватает
 * с запасом даже на 2×-экране, а WebP вместо PNG даёт ещё ~3×. Итог:
 * 145 КБ → 25-40 КБ, то есть страница легче примерно в 4-5 раз.
 *
 * Пропорция сохранена (768/539 ≈ 1228/862), чтобы `aspect-[1228/862]`
 * в карточках не пришлось трогать.
 */
export const PREVIEW_WIDTH = 768;
export const PREVIEW_HEIGHT = 539;

/** Качество WebP: 82 — предел, за которым текст таблицы начинает мылить. */
const WEBP_QUALITY = 82;

export type RenderedPreview = {
  /** Кодированная картинка (WebP; поле названо по колонке `JournalPreview.png`). */
  png: Buffer;
  width: number;
  height: number;
  contentType: string;
};

/**
 * Каталог пакета pdfjs-dist. Берём от `process.cwd()`, а не через
 * `createRequire`/`import.meta.url`: в webpack-сборке Next (`next build
 * --webpack`, как на проде) `import.meta.url` становится числовым id
 * модуля, а `createRequire` выдаёт объект без `resolve` — оба варианта
 * падали только на проде. `process.cwd()` — каталог приложения и у PM2
 * (`exec cwd`), и у `next dev`, и у тестов; `pdfjs-dist` — прямая
 * зависимость, поэтому лежит в корневом node_modules.
 */
function pdfjsDir(): string {
  const dir = path.join(process.cwd(), "node_modules", "pdfjs-dist");
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    throw new Error(`pdfjs-dist не найден в ${dir} (process.cwd()=${process.cwd()})`);
  }
  return dir;
}

export function workerFileUrl(): string {
  return pathToFileURL(path.join(pdfjsDir(), "legacy", "build", "pdf.worker.mjs")).href;
}

export function standardFontsDir(): string {
  // pdfjs склеивает url + имя файла как строки, поэтому нужен trailing slash.
  return path.join(pdfjsDir(), "standard_fonts").split(path.sep).join("/") + "/";
}

/**
 * Первая страница PDF → WebP в пропорции образцов (768×539), кадр сверху.
 *
 * Без браузера: pdfjs (legacy-сборка для Node) рисует в canvas от
 * `@napi-rs/canvas` — prebuilt-бинарник без системных зависимостей.
 * Шрифты берутся из самого PDF (jsPDF их встраивает), поэтому кириллица
 * выходит такой же, как при печати.
 *
 * Страница растеризуется в ДВОЙНОМ разрешении и уменьшается в целевое:
 * downsampling сглаживает тонкие линии таблицы, иначе рамки бланка на
 * 768px рвутся в пунктир.
 */
export async function renderPdfFirstPageToPng(
  pdf: Uint8Array | ArrayBuffer,
  opts: { width?: number; height?: number } = {}
): Promise<RenderedPreview> {
  const width = opts.width ?? PREVIEW_WIDTH;
  const height = opts.height ?? PREVIEW_HEIGHT;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // «Fake worker» в Node подгружает pdf.worker.mjs динамическим import'ом
  // по относительному пути — внутри Next-бандла его нет. Даём абсолютный
  // file:// на файл из node_modules (пакет к тому же в serverExternalPackages).
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  }
  const data = pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf);
  const task = pdfjs.getDocument({
    data,
    // Один процесс, без worker'а: рендер идёт в cron'е, параллелить нечего.
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    // Стандартные 14 шрифтов PDF (Helvetica и т. п.) не встраиваются в
    // файл — pdfjs подставляет свои из пакета. Без пути будет warning и
    // латиница fallback-шрифтом.
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const renderWidth = width * 2;
    const scale = renderWidth / base.width;
    const viewport = page.getViewport({ scale });

    const pageCanvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height)
    );
    const ctx = pageCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    } as Parameters<typeof page.render>[0]).promise;

    // Кадрируем сверху: шапка бланка и первые строки — то, что узнаётся.
    const out = createCanvas(width, height);
    const outCtx = out.getContext("2d");
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, width, height);
    outCtx.drawImage(pageCanvas, 0, 0, width * 2, height * 2, 0, 0, width, height);

    return {
      png: out.toBuffer("image/webp", WEBP_QUALITY),
      width,
      height,
      contentType: "image/webp",
    };
  } finally {
    // Закрывается loading task, а не документ: у PDFDocumentProxy в
    // v6 нет `destroy()`, а task освобождает и документ, и worker-порт.
    await task.destroy();
  }
}
