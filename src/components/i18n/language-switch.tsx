"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Globe2 } from "lucide-react";
import { localizedHref, publicLocaleRoute, SITE_LOCALE_COOKIE, type SiteLocale } from "@/i18n/site-locale";
import { useSiteLocale } from "./site-locale-provider";

export function LanguageSwitch() {
  const locale = useSiteLocale();
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  if (!pathname || !publicLocaleRoute(pathname)) return null;
  const nextLocale: SiteLocale = locale === "en" ? "ru" : "en";
  return (
    <a
      href={localizedHref(pathname + (search ? `?${search}` : ""), nextLocale)}
      hrefLang={nextLocale}
      lang={nextLocale}
      aria-label={locale === "en" ? "Switch to Russian" : "Switch to English"}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[#ececf4] px-2.5 text-[12px] font-semibold text-[#3848c7] transition-colors hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/20"
      onClick={(event) => {
        // Keep the real href usable without JS and for opening another tab.
        event.currentTarget.href = localizedHref(window.location.pathname + window.location.search + window.location.hash, nextLocale);
        document.cookie = `${SITE_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
      }}
    >
      <Globe2 className="size-3.5" aria-hidden="true" />
      {nextLocale.toUpperCase()}
    </a>
  );
}
