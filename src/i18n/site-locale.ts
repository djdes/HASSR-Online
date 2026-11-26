import { isPublicJournalDetailPath } from "./public-journal-detail-codes";
import { BASE_LOCALES, LOCALES, isLocale, resolveLocale, type Locale } from "./locales";
export type SiteLocale = Locale;
export const SITE_LOCALE_HEADER = "x-wesetup-site-locale";
export const SITE_LOCALE_COOKIE = "wesetup.site-locale";
// Set only by an explicit public language selection, consumed after verified sign-in.
export const PENDING_LOCALE_COOKIE = "wesetup.pending-locale";

/** Resolve a public API request from its own URL and locale cookie, without Next server-only APIs. */
export function resolveRequestLocale(
  request: Request,
  preferences: Parameters<typeof resolveLocale>[0] = {},
): Locale {
  const pathname = new URL(request.url).pathname;
  const route = publicLocaleRoute(pathname);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieLocale = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SITE_LOCALE_COOKIE}=`))
    ?.slice(SITE_LOCALE_COOKIE.length + 1);
  return resolveLocale({ ...preferences, publicLocale: route?.locale, cookieLocale });
}

// Explicit aliases only. Broader public content is still being migrated.
export const TRANSLATED_PUBLIC_ROUTES = ["/", "/login", "/register", "/features", "/journals-info", "/about", "/delete-account", "/partners", "/privacy"] as const;
const PUBLIC_ROUTES_BY_LOCALE: Record<SiteLocale, readonly string[]> = {
  ru: TRANSLATED_PUBLIC_ROUTES,
  en: TRANSLATED_PUBLIC_ROUTES,
  uz: TRANSLATED_PUBLIC_ROUTES,
  tg: TRANSLATED_PUBLIC_ROUTES,
  hy: TRANSLATED_PUBLIC_ROUTES,
  ky: TRANSLATED_PUBLIC_ROUTES,
  de: TRANSLATED_PUBLIC_ROUTES,
  fr: TRANSLATED_PUBLIC_ROUTES,
};

function hasPublicAlias(path: string, locale: SiteLocale): boolean {
  return PUBLIC_ROUTES_BY_LOCALE[locale].includes(path) || isPublicJournalDetailPath(path) || /^\/(?:blog|features)(?:\/[^/]+)?$/.test(path);
}

export function parseSiteLocale(value: unknown): SiteLocale {
  return isLocale(value) ? value : "ru";
}

export function publicLocaleRoute(pathname: string): { locale: SiteLocale; pathname: string } | null {
  const prefix = /^\/(en|uz|tg|hy|ky|de|fr)(?=\/|$)/.exec(pathname);
  const locale = prefix ? prefix[1] as SiteLocale : "ru";
  const path = prefix ? pathname.slice(prefix[0].length) || "/" : pathname;
  if (!hasPublicAlias(path, locale)) return null;
  return { locale, pathname: path };
}

export function publicLocalesForPath(pathname: string): SiteLocale[] {
  const route = publicLocaleRoute(pathname);
  return route ? LOCALES.filter((locale) => hasPublicAlias(route.pathname, locale)) : [];
}

/**
 * Языки, которые отдаём поисковикам (hreflang, sitemap). Таджикский,
 * армянский, киргизский, немецкий и французский переведены частично
 * (остальное подставляется из ru/en), поэтому их адреса работают для
 * людей, но в индекс не предлагаются, чтобы не плодить дубли.
 */
export function indexedLocalesForPath(pathname: string): SiteLocale[] {
  return publicLocalesForPath(pathname).filter((locale) => (BASE_LOCALES as readonly string[]).includes(locale));
}

/** Localize known public pages only; never rewrite APIs, callbacks or private routes. */
export function localizedHref(href: string, locale: SiteLocale): string {
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return href;
  const split = href.search(/[?#]/);
  const path = split === -1 ? href : href.slice(0, split);
  const suffix = split === -1 ? "" : href.slice(split);
  const route = publicLocaleRoute(path);
  if (!route) return href;
  if (!hasPublicAlias(route.pathname, locale)) return href;
  const target = locale !== "ru" ? `/${locale}${route.pathname === "/" ? "" : route.pathname}` : route.pathname;
  return target + suffix;
}

export function siteLanguageAlternates(pathname: string): Record<string, string> {
  return {
    ...Object.fromEntries(indexedLocalesForPath(pathname).map((locale) => [locale, `https://wesetup.ru${localizedHref(pathname, locale)}`])),
    "x-default": `https://wesetup.ru${localizedHref(pathname, "ru")}`,
  };
}
