import { isLocale, resolveLocale, type Locale } from "./locales";

/** Resolve once when downloading or enqueueing; never re-read a user's choice
 * when a background worker later generates the document. Invalid overrides
 * are rejected rather than silently exporting in a different language. */
export function resolveExportLocale(
  override: unknown,
  preferences: { locale?: string | null; organizationLocale?: string | null },
): Locale | null {
  if (override !== undefined && override !== null) return isLocale(override) ? override : null;
  return resolveLocale({ authenticated: true, userLocale: preferences.locale, organizationLocale: preferences.organizationLocale });
}
