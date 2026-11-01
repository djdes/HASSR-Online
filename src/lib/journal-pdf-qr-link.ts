import type { JournalPdfQr } from "@/lib/pdf-journal-qr";
import { qrFillUrl } from "@/lib/qr-fill-poster";
import { journalFillSubject } from "@/lib/journal-fill";
import { journalPointShortSig, journalShortSig, verifyJournalPointShortSig, verifyJournalShortSig } from "@/lib/qr-fill-token";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";

/**
 * Адреса QR в шапке печатного журнала.
 *
 * Настоящий документ → короткий `/qj/<orgId>/<code>/<sig>`, который ведёт на
 * основной QR журнала (тот же адрес, что на плакате «QR-точка контроля»:
 * запись по PIN, работает всегда). Образец бланка → `/journals-info/<code>`.
 *
 * Подписи сбоку больше нет (2026-09-27): QR — фирменная плитка в шапке со
 * своей полосой «Отсканировать» (`pdf-journal-qr.ts`).
 */

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

/** Короткий адрес QR журнала точки: `/qj/<точка>/<журнал>/<подпись точки>`. */
export function journalPointShortQrUrl(origin: string, buildingId: string, code: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/qj/${buildingId}/${code}/${journalPointShortSig(buildingId, code)}`;
}

/**
 * QR в шапке бланка документа. Документ точки — QR этой точки (аудит
 * 2026-11-01): раньше скан открывал выбор документов всех точек с их
 * людьми. Общий документ — QR журнала организации, как раньше.
 */
export function journalDocumentPdfQr(origin: string, orgId: string, code: string, buildingId?: string | null): JournalPdfQr {
  return { url: buildingId ? journalPointShortQrUrl(origin, buildingId, code) : journalShortQrUrl(origin, orgId, code) };
}

export function journalSamplePdfQr(origin: string, code: string): JournalPdfQr {
  const base = origin.replace(/\/+$/, "");
  return { url: `${base}/journals-info/${encodeURIComponent(code)}` };
}

/**
 * Куда вести короткую ссылку: путь основного QR журнала (с новым токеном —
 * срока у токенов нет) или `null`, если подпись не сходится.
 */
export function resolveJournalShortQr(orgId: string, code: string, sig: string): string | null {
  if (!verifyJournalShortSig(orgId, code, sig)) return null;
  return qrFillUrl("", "journal", `${orgId}:${code}`);
}

/**
 * Адрес журнала точки по короткой ссылке точки: подпись сверяется до
 * поиска точки в базе; организацию маршрут берёт у самой точки.
 */
export function isJournalPointShortQr(buildingId: string, code: string, sig: string): boolean {
  return verifyJournalPointShortSig(buildingId, code, sig);
}

export function resolveJournalPointShortQr(organizationId: string, buildingId: string, code: string): string {
  return qrFillUrl("", "journal", journalFillSubject(organizationId, code, null, { buildingId }));
}
