import { NextResponse } from "next/server";
import {
  isDocxBlankCode,
  isDocxSampleCode,
  renderJournalDocumentDocx,
} from "@/lib/document-docx";
import { journalPageContent } from "@/content/journal-page-content";
import {
  isSampleJournalCode,
} from "@/lib/journal-sample-fixtures";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { journalPdfQrOrigin } from "@/lib/journal-pdf-qr-link";
import type { BlankTarget } from "@/lib/blank-download";
import { verifyBlankDownloadToken } from "@/lib/blank-download-token";
import { blankFileQrUrl, loadBlankDownloadExtras } from "@/lib/blank-download-extras.server";
import { blankJournalCover } from "@/lib/journal-cover-pdf";

import { localizedJournalSampleInput, sampleDownloadDenied, sampleDownloadError, sampleLocaleFromUrl, sampleFooterLines } from "@/lib/public-sample-download-presentation";

export const runtime = "nodejs";

/**
 * Образец журнала в DOCX — для тех, кто хочет дописать бланк в Word.
 * Своя вёрстка — у DOCX_SAMPLE_CODES, у остальных журналов с образцом —
 * универсальная таблица по его колонкам (DOCX_BLANK_CODES).
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

  if (!isSampleJournalCode(code) || !isDocxBlankCode(code)) {
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
    const extras = await loadBlankDownloadExtras(check.extrasRef, code).catch((error) => {
      console.error("[journal-samples] extras load failed", error);
      return null;
    });
    const input = await localizedJournalSampleInput(code, locale, { blank: true, company: check.company, extras });
    const { buffer, fileName } = await renderJournalDocumentDocx(
      input,
      code,
      {
        // Галка «Добавить титульный лист» в окне — зашита в подписанную ссылку.
        cover: check.cover
          ? {
              cover: blankJournalCover(code, input.document.title),
              blank: {
                organization: check.company ?? null,
                responsiblePost: extras?.responsible?.position ?? null,
                responsibleName: extras?.responsible?.name ?? null,
              },
            }
          : null,
        // Свой Word-макет есть у части журналов; остальным — таблица по колонкам образца.
        columns: isDocxSampleCode(code) ? null : (journalPageContent(code, locale) ?? journalPageContent(code, "ru"))?.sample?.columns ?? null,
        footer: {
          qrUrl: blankFileQrUrl({ origin: journalPdfQrOrigin(), target, email: check.email, organizationId: check.organizationId }),
          lines: await sampleFooterLines(locale),
        },
      },
    );

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
