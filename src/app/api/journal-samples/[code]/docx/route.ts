import { NextResponse } from "next/server";
import {
  isDocxSampleCode,
  renderJournalDocumentDocx,
} from "@/lib/document-docx";
import {
  isSampleJournalCode,
} from "@/lib/journal-sample-fixtures";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { journalPdfQrOrigin } from "@/lib/journal-pdf-qr-link";
import type { BlankTarget } from "@/lib/blank-download";
import { verifyBlankDownloadToken } from "@/lib/blank-download-token";
import { blankQrUrl } from "@/lib/blank-qr-token";

import { localizedJournalSampleInput, sampleDownloadDenied, sampleDownloadError, sampleLocaleFromUrl, sampleFooterLines } from "@/lib/public-sample-download-presentation";

export const runtime = "nodejs";

/**
 * Образец журнала в DOCX — для тех, кто хочет дописать бланк в Word.
 * Собирается не для всех журналов: см. DOCX_SAMPLE_CODES.
 *
 * Только скачиванием по подписанной ссылке (`?t=`) из
 * POST /api/public/blank-download: встроенного просмотра у Word нет.
 * В подвале каждой страницы — строка копирайта и QR на /qb с
 * зашифрованной почтой скачавшего.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const language = sampleLocaleFromUrl(request.url);
  if (!language.ok) return sampleDownloadError("ru", "invalidLocale", 400);
  const { locale } = language;

  if (!isSampleJournalCode(code) || !isDocxSampleCode(code)) {
    return sampleDownloadError(locale, "pdfOnly", 404);
  }

  const target: BlankTarget = { kind: "code", code };
  const check = verifyBlankDownloadToken(new URL(request.url).searchParams.get("t"), {
    target,
    format: "docx",
  });
  if (!check.ok) return sampleDownloadDenied(request, target, "docx", check.reason, locale);

  const ip = clientIp(request) ?? "unknown";
  if (!journalSampleRateLimiter.consume(`sample:${ip}`)) {
    return sampleDownloadError(locale, "tooMany", 429);
  }

  try {
    const { buffer, fileName } = await renderJournalDocumentDocx(await localizedJournalSampleInput(code, locale), code, {
      footer: {
        qrUrl: blankQrUrl(journalPdfQrOrigin(), { target, email: check.email }).url,
        lines: await sampleFooterLines(locale),
      },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Language": locale,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          fileName
        )}`,
        // Файл свой у каждой почты (QR) — только в браузере скачавшего.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("journal sample docx failed", code, error);
    return sampleDownloadError(locale, "buildFailed", 500);
  }
}
