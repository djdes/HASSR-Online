import { isPublicJournalDetailPath } from "./public-journal-detail-codes";
import { isLocale, resolveLocale, type Locale } from "./locales";
export type SiteLocale = Locale;
export const SITE_LOCALE_HEADER = "x-wesetup-site-locale";
export const SITE_LOCALE_COOKIE = "wesetup.site-locale";

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
export const TRANSLATED_PUBLIC_ROUTES = ["/", "/login", "/register", "/features", "/journals-info"] as const;
const PUBLIC_ROUTES_BY_LOCALE: Record<SiteLocale, readonly string[]> = {
  ru: TRANSLATED_PUBLIC_ROUTES,
  en: TRANSLATED_PUBLIC_ROUTES,
  uz: TRANSLATED_PUBLIC_ROUTES,
};

function hasPublicAlias(path: string, locale: SiteLocale): boolean {
  return PUBLIC_ROUTES_BY_LOCALE[locale].includes(path) || isPublicJournalDetailPath(path) || /^\/(?:blog|features)(?:\/[^/]+)?$/.test(path);
}

export function parseSiteLocale(value: unknown): SiteLocale {
  return isLocale(value) ? value : "ru";
}

export function publicLocaleRoute(pathname: string): { locale: SiteLocale; pathname: string } | null {
  const prefix = /^\/(en|uz)(?=\/|$)/.exec(pathname);
  const locale = prefix ? prefix[1] as SiteLocale : "ru";
  const path = prefix ? pathname.slice(prefix[0].length) || "/" : pathname;
  if (!hasPublicAlias(path, locale)) return null;
  return { locale, pathname: path };
}

export function publicLocalesForPath(pathname: string): SiteLocale[] {
  const route = publicLocaleRoute(pathname);
  return route ? (["ru", "en", "uz"] as const).filter((locale) => hasPublicAlias(route.pathname, locale)) : [];
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
    ...Object.fromEntries(publicLocalesForPath(pathname).map((locale) => [locale, `https://wesetup.ru${localizedHref(pathname, locale)}`])),
    "x-default": `https://wesetup.ru${localizedHref(pathname, "ru")}`,
  };
}
