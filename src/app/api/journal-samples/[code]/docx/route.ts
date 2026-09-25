import { NextResponse } from "next/server";
import {
  isDocxSampleCode,
  renderJournalDocumentDocx,
} from "@/lib/document-docx";
import {
  buildJournalSampleInput,
  isSampleJournalCode,
} from "@/lib/journal-sample-fixtures";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { journalPdfQrOrigin } from "@/lib/journal-pdf-qr-link";
import type { BlankTarget } from "@/lib/blank-download";
import { blankDownloadDenied, verifyBlankDownloadToken } from "@/lib/blank-download-token";
import { BLANK_QR_LINES, blankQrUrl } from "@/lib/blank-qr-token";

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

  if (!isSampleJournalCode(code) || !isDocxSampleCode(code)) {
    return NextResponse.json(
      { error: "Для этого журнала образец есть только в PDF" },
      { status: 404 }
    );
  }

  const target: BlankTarget = { kind: "code", code };
  const check = verifyBlankDownloadToken(new URL(request.url).searchParams.get("t"), {
    target,
    format: "docx",
  });
  if (!check.ok) return blankDownloadDenied(request, target, "docx", check.reason);

  const ip = clientIp(request) ?? "unknown";
  if (!journalSampleRateLimiter.consume(`sample:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте через минуту" },
      { status: 429 }
    );
  }

  try {
    const { buffer, fileName } = await renderJournalDocumentDocx(buildJournalSampleInput(code), code, {
      footer: {
        qrUrl: blankQrUrl(journalPdfQrOrigin(), { target, email: check.email }).url,
        lines: BLANK_QR_LINES,
      },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
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
    return NextResponse.json(
      { error: "Не получилось собрать образец" },
      { status: 500 }
    );
  }
}
