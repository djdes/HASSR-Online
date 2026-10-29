/**
 * Растеризует листы PDF в PNG (для просмотра вёрстки глазами).
 * npx tsx .agent/tasks/client-contract-2026-10-29/raw/pdf-to-png.ts <file.pdf> [page ...]
 */
import fs from "node:fs";

import { createCanvas } from "@napi-rs/canvas";

import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

async function main() {
  const [file, ...pages] = process.argv.slice(2);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await task.promise;
  const wanted = pages.length ? pages.map(Number) : Array.from({ length: doc.numPages }, (_, index) => index + 1);
  for (const n of wanted) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<typeof page.render>[0]).promise;
    const out = file.replace(/\.pdf$/i, `-p${n}.png`);
    fs.writeFileSync(out, canvas.toBuffer("image/png"));
    console.log(out);
  }
  await task.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
