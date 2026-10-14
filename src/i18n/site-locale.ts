export type SiteLocale = "ru" | "en";
export const SITE_LOCALE_HEADER = "x-wesetup-site-locale";
export const SITE_LOCALE_COOKIE = "wesetup.site-locale";

// Add a route only after its English content and metadata have been verified.
export const TRANSLATED_PUBLIC_ROUTES = ["/", "/login", "/register"] as const;

export function parseSiteLocale(value: unknown): SiteLocale {
  return value === "en" ? "en" : "ru";
}

export function publicLocaleRoute(pathname: string): { locale: SiteLocale; pathname: string } | null {
  const english = pathname === "/en" || pathname.startsWith("/en/");
  const path = english ? pathname.slice(3) || "/" : pathname;
  if (!(TRANSLATED_PUBLIC_ROUTES as readonly string[]).includes(path)) return null;
  return { locale: english ? "en" : "ru", pathname: path };
}

/** Localize known public pages only; never rewrite APIs, callbacks or private routes. */
export function localizedHref(href: string, locale: SiteLocale): string {
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return href;
  const split = href.search(/[?#]/);
  const path = split === -1 ? href : href.slice(0, split);
  const suffix = split === -1 ? "" : href.slice(split);
  const route = publicLocaleRoute(path);
  if (!route) return href;
  const target = locale === "en" ? `/en${route.pathname === "/" ? "" : route.pathname}` : route.pathname;
  return target + suffix;
}

export function siteLanguageAlternates(pathname: string) {
  return {
    ru: `https://wesetup.ru${localizedHref(pathname, "ru")}`,
    en: `https://wesetup.ru${localizedHref(pathname, "en")}`,
    "x-default": `https://wesetup.ru${localizedHref(pathname, "ru")}`,
  };
}
