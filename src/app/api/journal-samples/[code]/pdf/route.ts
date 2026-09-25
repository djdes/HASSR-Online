import { NextResponse } from "next/server";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import {
  buildJournalSampleInput,
  isSampleJournalCode,
} from "@/lib/journal-sample-fixtures";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { journalPdfQrOrigin } from "@/lib/journal-pdf-qr-link";
import type { BlankTarget } from "@/lib/blank-download";
import { blankDownloadDenied, verifyBlankDownloadToken } from "@/lib/blank-download-token";
import { blankPdfQr } from "@/lib/blank-qr-token";

export const runtime = "nodejs";

/**
 * Образец журнала в PDF.
 *
 * Данные полностью вымышленные — роут не обращается к БД и физически не
 * может отдать чужой журнал.
 *
 * Два режима (2026-09-25, шаблоны после email):
 *   • `?inline=1` — встроенный просмотр на странице журнала и генератор
 *     миниатюр: публично, без почты, кеш сутки. QR ведёт на /qb с токеном
 *     только журнала;
 *   • `?t=<токен>` — скачивание «вложением» по подписанной ссылке из
 *     POST /api/public/blank-download. В QR зашифрована почта, которую
 *     человек ввёл, — страница /qb подставит её в регистрацию.
 * Без действующего токена файл не отдаётся: браузер уходит на страницу
 * журнала с открытым окном email, остальные получают 403.
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

  const target: BlankTarget = { kind: "code", code };
  const search = new URL(request.url).searchParams;
  // ?inline=1 — для встроенного просмотра на странице журнала:
  // attachment заставил бы браузер скачать файл вместо показа.
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
      { status: 429 }
    );
  }

  try {
    // В углу каждой страницы — QR на /qb и строка копирайта.
    const { buffer, fileName } = renderJournalDocumentPdf({
      ...buildJournalSampleInput(code),
      qr: blankPdfQr(journalPdfQrOrigin(), { target, email }),
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // filename* — иначе кириллица в имени файла превращается в
        // «_______.pdf» у половины браузеров.
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
          `obrazec-${fileName}`
        )}`,
        // Встроенный образец детерминирован (период зафиксирован в
        // фикстурах) — держим в кеше сутки. Скачанный файл свой у каждой
        // почты: только в браузере скачавшего.
        "Cache-Control": inline ? "public, max-age=86400, s-maxage=86400" : "private, no-store",
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
