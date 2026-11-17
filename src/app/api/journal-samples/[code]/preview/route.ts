import { NextResponse } from "next/server";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { renderPdfFirstPageToPng } from "@/lib/journal-preview/render";
import { isSampleJournalCode } from "@/lib/journal-sample-fixtures";
import { journalPdfQrOrigin } from "@/lib/journal-pdf-qr-link";
import { blankPdfQr } from "@/lib/blank-qr-token";
import { localizedJournalSampleInput, sampleLocaleFromUrl } from "@/lib/public-sample-download-presentation";

export const runtime = "nodejs";

/**
 * GET /api/journal-samples/<код>/preview — первая страница пустого бланка
 * картинкой (WebP) для страницы журнала (спека
 * journal-page-engagement-2026-11). Встроенный PDF на телефонах не
 * показывался вовсе, а на компьютере тянул весь файл; картинка лёгкая и
 * видна везде. Бланк детерминирован — кешируем в памяти и на CDN сутки.
 */

const WIDTH = 1100;
// A4 альбомная: 297 × 210 — картинка целой страницы, без обрезки.
const HEIGHT = Math.round(WIDTH / (297 / 210));
const cache = new Map<string, Buffer>();

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const language = sampleLocaleFromUrl(request.url);
  if (!language.ok || !isSampleJournalCode(code)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const key = `${code}:${language.locale}`;
  let image = cache.get(key);
  if (!image) {
    try {
      const { buffer } = renderJournalDocumentPdf({
        ...(await localizedJournalSampleInput(code, language.locale, { blank: true })),
        qr: { ...blankPdfQr(journalPdfQrOrigin(), { target: { kind: "code", code } }), locale: language.locale },
      });
      image = (await renderPdfFirstPageToPng(new Uint8Array(buffer), { width: WIDTH, height: HEIGHT })).png;
      if (cache.size > 200) cache.clear();
      cache.set(key, image);
    } catch (error) {
      console.error("[journal-samples] preview failed", code, error);
      return new NextResponse("Preview failed", { status: 500 });
    }
  }
  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
