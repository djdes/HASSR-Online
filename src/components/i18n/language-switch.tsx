"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Globe2 } from "lucide-react";
import { localizedHref, publicLocalesForPath, SITE_LOCALE_COOKIE } from "@/i18n/site-locale";
import { LOCALE_NAMES } from "@/i18n/locales";
import { useTranslations } from "next-intl";
import { useSiteLocale } from "./site-locale-provider";

export function LanguageSwitch() {
  const locale = useSiteLocale();
  const t = useTranslations("language");
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  const available = pathname ? publicLocalesForPath(pathname) : [];
  if (!pathname || available.length < 2) return null;
  return (
    <div role="group" aria-label={t("label")} className="inline-flex items-center gap-1">
    {available.map((nextLocale) => (
    <a
      key={nextLocale}
      href={localizedHref(pathname + (search ? `?${search}` : ""), nextLocale)}
      hrefLang={nextLocale}
      lang={nextLocale}
      aria-label={LOCALE_NAMES[nextLocale]}
      aria-current={locale === nextLocale ? "page" : undefined}
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
    ))}
    </div>
  );
}
