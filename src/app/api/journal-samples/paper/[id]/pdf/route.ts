import { NextResponse } from "next/server";
import { renderPaperJournalPdf } from "@/lib/paper-journal-pdf";
import { paperJournalById } from "@/lib/sphere-journal-rules";
import { SAMPLE_ORGANIZATION } from "@/lib/journal-sample-fixtures";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { journalPdfQrOrigin } from "@/lib/journal-pdf-qr-link";
import type { BlankTarget } from "@/lib/blank-download";
import { blankDownloadDenied, verifyBlankDownloadToken } from "@/lib/blank-download-token";
import { blankPdfQr } from "@/lib/blank-qr-token";

export const runtime = "nodejs";

/**
 * Публичный образец бумажного бланка в PDF.
 *
 * `?inline=1` — публично: этим роутом пользуется генератор превью
 * (scripts/render-journal-sample-thumbs.ts). Скачивание «вложением» —
 * только по подписанной ссылке (`?t=`) из POST /api/public/blank-download,
 * как у электронных образцов; без неё браузер уходит на /blanki с окном
 * email. К БД не обращается, шапка — вымышленная «Ромашка», так что
 * отдать чужие данные роут физически не может.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const journal = paperJournalById(id);
  if (!journal) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }

  const target: BlankTarget = { kind: "paper", paperId: journal.id };
  const search = new URL(request.url).searchParams;
  const inline = search.get("inline") === "1";
  let email: string | null = null;
  if (!inline) {
    const check = verifyBlankDownloadToken(search.get("t"), { target, format: "pdf" });
    if (!check.ok) return blankDownloadDenied(request, target, "pdf", check.reason);
    email = check.email;
  }

  const ip = clientIp(request) ?? "unknown";
  if (!journalSampleRateLimiter.consume(`sample:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте через минуту" },
      { status: 429 },
    );
  }

  try {
    const buffer = renderPaperJournalPdf({
      journal,
      organization: SAMPLE_ORGANIZATION,
      rows: [],
      blankRows: 18,
      qr: blankPdfQr(journalPdfQrOrigin(), { target, email }),
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
          `obrazec-${journal.id}.pdf`,
        )}`,
        // Встроенный бланк детерминирован — пустая таблица с фиксированной
        // шапкой; скачанный свой у каждой почты (QR).
        "Cache-Control": inline ? "public, max-age=86400, s-maxage=86400" : "private, no-store",
      },
    });
  } catch (error) {
    console.error("paper journal sample pdf failed", id, error);
    return NextResponse.json(
      { error: "Не получилось собрать PDF" },
      { status: 500 },
    );
  }
}
