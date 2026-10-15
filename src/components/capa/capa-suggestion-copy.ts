import { NextResponse } from "next/server";
import { translatorFor } from "@/i18n/translator";
import type { Locale } from "@/i18n/locales";
import { CAPA_ERROR_CODES } from "./capa-presentation";

const ERROR_STATUS = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID_LOCALE: 400,
  INVALID_STEP: 400, SUGGEST_UNAVAILABLE: 503, SUGGEST_FAILED: 502, SUGGEST_INVALID: 502,
} as const;

export async function capaSuggestionErrorResponse(code: keyof typeof ERROR_STATUS, locale: Locale, extra?: { raw: string }) {
  const t = await translatorFor(locale);
  return NextResponse.json({ code, error: t(`capaManagement.errors.${CAPA_ERROR_CODES[code]}`), ...extra }, {
    status: ERROR_STATUS[code],
    headers: { "Cache-Control": "private, no-store", "Content-Language": locale },
  });
}
