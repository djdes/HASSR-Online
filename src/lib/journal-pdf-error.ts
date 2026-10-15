import type { Locale } from "@/i18n/locales";
import { journalPdfCopy } from "@/i18n/journal-pdf-copy";
import { escapeHtml } from "./html-escape";

const ERRORS = {
  UNAUTHORIZED: { key: "errors.unauthorized", status: 401 },
  INVALID_LOCALE: { key: "errors.invalidLocale", status: 400 },
  DOCUMENT_NOT_FOUND: { key: "errors.notFound", status: 404 },
  JOURNAL_FORBIDDEN: { key: "errors.forbidden", status: 403 },
  PDF_FAILED: { key: "errors.failed", status: 500 },
} as const;

export function journalPdfErrorResponse(request: Request, code: keyof typeof ERRORS, locale: Locale) {
  const t = journalPdfCopy(locale);
  const { key, status } = ERRORS[code];
  const message = t(key);
  const headers = { "Cache-Control": "private, no-store", "Content-Language": locale };
  const wantsHtml = request.headers.get("sec-fetch-dest") === "document" || (request.headers.get("accept") ?? "").includes("text/html");
  if (!wantsHtml) return Response.json({ code, error: message }, { status, headers });
  return new Response(`<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(t("errors.title"))}</title>
<style>body{font-family:Arial,sans-serif;background:#f5f7fb;color:#111827;margin:0}.card{max-width:720px;margin:64px auto;background:#fff;border:1px solid #dbe1ea;border-radius:24px;padding:32px;box-shadow:0 12px 30px rgba(15,23,42,.08)}h1{margin:0 0 12px;font-size:28px}p{margin:0;font-size:18px;line-height:1.5;color:#4b5563}</style>
</head><body><main class="card"><h1>${escapeHtml(t("errors.heading"))}</h1><p>${escapeHtml(message)}</p></main></body></html>`, {
    status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}
