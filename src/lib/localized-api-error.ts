/** Accept server copy only when the response explicitly matches this screen's
 * language. Older endpoints retain their string fields but use a local fallback
 * until migrated. The helper does not infer language from customer text. */
export async function readLocalizedApiError(response: Response, locale: string | (() => string), fallback: string | (() => string)): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  const currentLocale = typeof locale === "function" ? locale() : locale;
  const currentFallback = typeof fallback === "function" ? fallback() : fallback;
  if (response.headers.get("Content-Language") !== currentLocale || !payload || typeof payload !== "object") return currentFallback;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : currentFallback;
}
