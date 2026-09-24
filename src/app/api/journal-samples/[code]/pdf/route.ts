import { NextResponse } from "next/server";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import {
  buildJournalSampleInput,
  isSampleJournalCode,
} from "@/lib/journal-sample-fixtures";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { journalPdfQrOrigin, journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";

export const runtime = "nodejs";

/**
 * Публичный образец журнала в PDF.
 *
 * Без сессии: это витрина лендинга, человек должен увидеть готовый
 * бланк до регистрации. Данные полностью вымышленные — роут не
 * обращается к БД и физически не может отдать чужой журнал.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Белый список: без него в generateJournalDocumentPdf прилетал бы
  // произвольный код из URL.
  if (!isSampleJournalCode(code)) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }

  const ip = clientIp(request) ?? "unknown";
  if (!journalSampleRateLimiter.consume(`sample:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте через минуту" },
      { status: 429 }
    );
  }

  try {
    // QR в углу образца ведёт на страницу журнала на сайте (без токенов).
    const { buffer, fileName } = renderJournalDocumentPdf({
      ...buildJournalSampleInput(code),
      qr: journalSamplePdfQr(journalPdfQrOrigin(), code),
    });

    // ?inline=1 — для встроенного просмотра на странице журнала:
    // attachment заставил бы браузер скачать файл вместо показа.
    const inline = new URL(request.url).searchParams.get("inline") === "1";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // filename* — иначе кириллица в имени файла превращается в
        // «_______.pdf» у половины браузеров.
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
          `obrazec-${fileName}`
        )}`,
        // Образец детерминирован (период зафиксирован в фикстурах),
        // поэтому его можно спокойно держать в кеше сутки.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (error) {
    console.error("journal sample pdf failed", code, error);
    return NextResponse.json(
      { error: "Не получилось собрать образец" },
      { status: 500 }
    );
  }
}
