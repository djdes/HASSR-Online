"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Globe2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { localizedHref, publicLocalesForPath, SITE_LOCALE_COOKIE, PENDING_LOCALE_COOKIE, type SiteLocale } from "@/i18n/site-locale";
import { LOCALE_NAMES } from "@/i18n/locales";
import { useTranslations } from "next-intl";
import { useSiteLocale } from "./site-locale-provider";

function refreshLanguageHref(anchor: HTMLAnchorElement, locale: SiteLocale) {
  anchor.href = localizedHref(window.location.pathname + window.location.search + window.location.hash, locale);
}

function rememberLanguageChoice(locale: SiteLocale) {
  const attributes = `Path=/; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  document.cookie = `${SITE_LOCALE_COOKIE}=${locale}; Max-Age=31536000; ${attributes}`;
  // A separate cookie distinguishes a deliberate choice from proxy/default locale cookies.
  document.cookie = `${PENDING_LOCALE_COOKIE}=${locale}; Max-Age=86400; ${attributes}`;
}

export function LanguageSwitch() {
  const locale = useSiteLocale();
  const t = useTranslations("language");
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  const available = pathname ? publicLocalesForPath(pathname) : [];
  if (!pathname || available.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t("label")}: ${LOCALE_NAMES[locale]}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[#ececf4] px-3 text-[12px] font-semibold text-[#3848c7] transition-colors hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/20"
        >
          <Globe2 className="size-3.5" aria-hidden="true" />
          {locale.toUpperCase()}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={t("label")}>
        {available.map((nextLocale) => (
          <DropdownMenuItem key={nextLocale} asChild>
            <a
              href={localizedHref(pathname + (search ? `?${search}` : ""), nextLocale)}
              hrefLang={nextLocale}
              lang={nextLocale}
              aria-current={locale === nextLocale ? "page" : undefined}
              onPointerDown={(event) => refreshLanguageHref(event.currentTarget, nextLocale)}
              onContextMenu={(event) => refreshLanguageHref(event.currentTarget, nextLocale)}
              onAuxClick={(event) => {
                refreshLanguageHref(event.currentTarget, nextLocale);
                if (event.button === 1) rememberLanguageChoice(nextLocale);
              }}
              onClick={(event) => {
                // Keep the real href usable for opening another tab.
                refreshLanguageHref(event.currentTarget, nextLocale);
                rememberLanguageChoice(nextLocale);
              }}
            >
              <span className="flex-1">{LOCALE_NAMES[nextLocale]}</span>
              {locale === nextLocale ? <Check className="size-4 text-[#3848c7]" aria-hidden="true" /> : null}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
