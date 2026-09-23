import { createCanvas } from "@napi-rs/canvas";

import { standardFontsDir, workerFileUrl } from "./render";

/**
 * Растеризация ЛЮБОЙ страницы PDF целиком (не кадр первой страницы, как
 * у превью карточек в `render.ts`). Нужна порталу проверяющего: журнал
 * показывается листами той же печатной формы, что и при печати.
 *
 * Та же связка pdfjs (legacy-сборка для Node) + `@napi-rs/canvas`, без
 * браузера. Страница рисуется в полтора раза крупнее и уменьшается до
 * целевой ширины: так тонкие рамки бланка не рвутся в пунктир.
 */
export const SHEET_WIDTH = 1600;
const SUPERSAMPLE = 1.5;

export type RenderedSheet = {
  png: Buffer;
  width: number;
  height: number;
  contentType: "image/png";
};

async function openPdf(pdf: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  }
  // Копия: pdfjs может забрать (detach) переданный буфер, а PDF лежит в
  // кэше и рендерится повторно — по листу на запрос.
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  return task;
}

export async function countPdfPages(pdf: Uint8Array): Promise<number> {
  const task = await openPdf(pdf);
  try {
    const doc = await task.promise;
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}

export async function renderPdfPageToPng(
  pdf: Uint8Array,
  pageNumber: number,
  opts: { width?: number } = {}
): Promise<RenderedSheet> {
  const width = opts.width ?? SHEET_WIDTH;
  const task = await openPdf(pdf);
  try {
    const doc = await task.promise;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
      throw new RangeError(`Нет страницы ${pageNumber} (всего ${doc.numPages})`);
    }
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = (width * SUPERSAMPLE) / base.width;
    const viewport = page.getViewport({ scale });

    const big = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = big.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, big.width, big.height);
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    } as Parameters<typeof page.render>[0]).promise;

    const height = Math.round((width * base.height) / base.width);
    const out = createCanvas(width, height);
    const outCtx = out.getContext("2d");
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, width, height);
    outCtx.drawImage(big, 0, 0, big.width, big.height, 0, 0, width, height);

    return { png: out.toBuffer("image/png"), width, height, contentType: "image/png" };
  } finally {
    await task.destroy();
  }
}
