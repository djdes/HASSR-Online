import { NextResponse } from "next/server";
import { isLocale, type Locale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/site-locale";
import { translatorFor } from "@/i18n/translator";
import type { Messages } from "@/i18n/messages";
import type { BlankFormat, BlankTarget } from "@/lib/blank-download";
import { blankDownloadDenied, type BlankDownloadCheck } from "@/lib/blank-download-token";
import { buildJournalSampleInput, type SampleJournalCode } from "@/lib/journal-sample-fixtures";

type SampleError = "invalidLocale" | "notFound" | "pdfOnly" | "tooMany" | "buildFailed" | "expired" | "required";

/** Cacheable sample language comes only from this URL, never cookies or sessions. */
export function sampleLocaleFromUrl(url: string): { ok: true; locale: Locale } | { ok: false } {
  const values = new URL(url).searchParams.getAll("locale");
  if (values.length === 0) return { ok: true, locale: "ru" };
  return values.length === 1 && isLocale(values[0]) ? { ok: true, locale: values[0] } : { ok: false };
}

export async function sampleDownloadError(locale: Locale, key: SampleError, status: number) {
  const t = await translatorFor(locale);
  return NextResponse.json({ error: t(`publicSampleDownloads.${key}`), errorCode: `sample_${key}` }, {
    status, headers: { "Content-Language": locale, "Cache-Control": "no-store" },
  });
}

/** This boundary owns generated samples only; saved titles/config/values never enter it. */
export async function localizedJournalSampleInput(code: SampleJournalCode, locale: Locale) {
  const input = buildJournalSampleInput(code);
  if (locale === "ru") return { ...input, locale };
  const t = await translatorFor(locale);
  const title = t(`journals.names.${code as keyof Messages["journals"]["names"]}`);
  return { ...input, locale, document: { ...input.document, title, template: { ...input.document.template, name: title } } };
}

/** Reuse the original authorization denial, changing only known presentation fields. */
export async function sampleDownloadDenied(
  request: Request, target: BlankTarget, format: BlankFormat,
  reason: Exclude<BlankDownloadCheck, { ok: true }>["reason"], locale: Locale,
): Promise<Response> {
  const original = blankDownloadDenied(request, target, format, reason);
  original.headers.set("Content-Language", locale);
  if (locale === "ru") return original;
  if (original.status === 307) {
    original.headers.set("Location", localizedHref(original.headers.get("Location") ?? "/", locale));
    return original;
  }
  const body = await original.json() as { error: string; page: string };
  const t = await translatorFor(locale);
  return NextResponse.json({ ...body, page: localizedHref(body.page, locale), error: t(reason === "expired" ? "publicSampleDownloads.expired" : "publicSampleDownloads.required") }, {
    status: original.status, headers: original.headers,
  });
}

/** Fixed sample branding only; arbitrary caller footer lines remain original. */
export async function sampleFooterLines(locale: Locale): Promise<[string, string]> {
  const t = await translatorFor(locale);
  return [t("publicSampleDownloads.qrCaption"), t("publicSampleDownloads.copyright")];
}
