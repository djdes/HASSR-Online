import type { JournalPdfQr } from "@/lib/pdf-journal-qr";
import { qrFillUrl } from "@/lib/qr-fill-poster";
import { journalShortSig, verifyJournalShortSig } from "@/lib/qr-fill-token";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";

/**
 * Адреса маленького QR в углу печатного журнала.
 *
 * Настоящий документ → короткий `/qj/<orgId>/<code>/<sig>`, который ведёт на
 * основной QR журнала (тот же адрес, что на плакате «QR-точка контроля»:
 * запись по PIN, работает всегда). Образец бланка → `/journals-info/<code>`.
 */

/** Подпись у QR — одна для настоящих документов и образцов бланков. */
export const JOURNAL_QR_CAPTION_LINES = ["Заполнение электронного журнала", "wesetup.ru"];
export const JOURNAL_DOCUMENT_QR_LINES = JOURNAL_QR_CAPTION_LINES;
export const JOURNAL_SAMPLE_QR_LINES = JOURNAL_QR_CAPTION_LINES;

/** Домен ссылок — как у QR-плакатов (на проде только свой домен). */
export function journalPdfQrOrigin(): string {
  return resolveQrPosterOrigin({
    configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
    production: process.env.NODE_ENV === "production",
  });
}

export function journalShortQrUrl(origin: string, orgId: string, code: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/qj/${orgId}/${code}/${journalShortSig(orgId, code)}`;
}

export function journalDocumentPdfQr(origin: string, orgId: string, code: string): JournalPdfQr {
  return { url: journalShortQrUrl(origin, orgId, code), lines: JOURNAL_DOCUMENT_QR_LINES };
}

export function journalSamplePdfQr(origin: string, code: string): JournalPdfQr {
  const base = origin.replace(/\/+$/, "");
  return { url: `${base}/journals-info/${encodeURIComponent(code)}`, lines: JOURNAL_SAMPLE_QR_LINES };
}

/**
 * Куда вести короткую ссылку: путь основного QR журнала (с новым токеном —
 * срока у токенов нет) или `null`, если подпись не сходится.
 */
export function resolveJournalShortQr(orgId: string, code: string, sig: string): string | null {
  if (!verifyJournalShortSig(orgId, code, sig)) return null;
  return qrFillUrl("", "journal", `${orgId}:${code}`);
}
