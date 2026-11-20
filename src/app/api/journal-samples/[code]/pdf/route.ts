import { NextResponse } from "next/server";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import {
  isSampleJournalCode,
} from "@/lib/journal-sample-fixtures";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { journalPdfQrOrigin } from "@/lib/journal-pdf-qr-link";
import type { BlankTarget } from "@/lib/blank-download";
import { verifyBlankDownloadToken } from "@/lib/blank-download-token";
import type { BlankExtras } from "@/lib/blank-download-extras";
import { blankFileQrUrl, loadBlankDownloadExtras } from "@/lib/blank-download-extras.server";
import { renderPaperJournalPdfDetailed } from "@/lib/paper-journal-pdf";
import type { BlankLayout } from "@/lib/blank-layout";

import { localizedJournalSampleInput, sampleDownloadDenied, sampleDownloadError, sampleLocaleFromUrl, sampleFooterLines } from "@/lib/public-sample-download-presentation";

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
  const language = sampleLocaleFromUrl(request.url);
  if (!language.ok) return sampleDownloadError("ru", "invalidLocale", 400);
  const { locale } = language;

  // Белый список: без него в generateJournalDocumentPdf прилетал бы
  // произвольный код из URL.
  if (!isSampleJournalCode(code)) {
    return sampleDownloadError(locale, "notFound", 404);
  }

  const target: BlankTarget = { kind: "code", code };
  const search = new URL(request.url).searchParams;
  // ?inline=1 — для встроенного просмотра на странице журнала:
  // attachment заставил бы браузер скачать файл вместо показа.
  const inline = search.get("inline") === "1";
  const blank = search.get("blank") === "1" || !inline;
  let email: string | null = null;
  let company: string | undefined;
  let organizationId: string | null = null;
  let extras: BlankExtras | null = null;
  // Галка «Добавить титульный лист» в окне — зашита в подписанную ссылку.
  let cover = false;
  if (!inline) {
    const check = verifyBlankDownloadToken(search.get("t"), { target, format: "pdf" });
    if (!check.ok) return sampleDownloadDenied(request, target, "pdf", check.reason, locale);
    email = check.email;
    company = check.company;
    organizationId = check.organizationId ?? null;
    cover = check.cover === true;
    // «Дополнительно» из окна — сотрудники, оборудование, помещения в бланке.
    extras = await loadBlankDownloadExtras(check.extrasRef, code).catch((error) => {
      console.error("[journal-samples] extras load failed", error);
      return null;
    });
  }

  const ip = clientIp(request) ?? "unknown";
  if (!journalSampleRateLimiter.consume(`sample:${ip}`)) {
    return sampleDownloadError(locale, "tooMany", 429);
  }

  try {
    // Свой бланк из конструктора на странице журнала: колонки и строки
    // человека, та же шапка организации и QR.
    if (extras?.layout) {
      const { buffer } = customLayoutPdf(extras.layout, {
        company,
        qr: {
          url: blankFileQrUrl({ origin: journalPdfQrOrigin(), target, email, organizationId }),
          locale,
          footer: (await sampleFooterLines(locale)).join(" · "),
        },
      });
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Language": locale,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`blank-${code}.pdf`)}`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    // QR на /qb — в шапке каждой страницы, строка копирайта — внизу.
    const { buffer, fileName } = renderJournalDocumentPdf({
      ...await localizedJournalSampleInput(code, locale, { blank, company, extras }),
      ...(cover
        ? {
            blankCover: {
              organization: company ?? null,
              responsiblePost: extras?.responsible?.position ?? null,
              responsibleName: extras?.responsible?.name ?? null,
            },
          }
        : {}),
      qr: {
        url: blankFileQrUrl({ origin: journalPdfQrOrigin(), target, email, organizationId }),
        locale,
        footer: (await sampleFooterLines(locale)).join(" · "),
      },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Language": locale,
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
    return sampleDownloadError(locale, "buildFailed", 500);
  }
}

function customLayoutPdf(
  layout: BlankLayout,
  params: { company?: string; qr: Parameters<typeof renderPaperJournalPdfDetailed>[0]["qr"] },
) {
  return renderPaperJournalPdfDetailed({
    journal: {
      id: "custom",
      name: layout.title,
      why: "",
      law: { label: "", url: "" },
      fineHint: "",
      columns: layout.columns,
    },
    organization: { name: params.company?.trim() || "Организация" },
    blankRows: layout.rows,
    note: "Форма составлена в конструкторе WeSetup · электронная версия — wesetup.ru",
    qr: params.qr,
  });
}
