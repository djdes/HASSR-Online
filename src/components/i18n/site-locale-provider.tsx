"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SiteLocale } from "@/i18n/site-locale";

const SiteLocaleContext = createContext<SiteLocale>("ru");

export function SiteLocaleProvider({ locale, children }: { locale: SiteLocale; children: ReactNode }) {
  return <SiteLocaleContext.Provider value={locale}>{children}</SiteLocaleContext.Provider>;
}

export function useSiteLocale(): SiteLocale {
  return useContext(SiteLocaleContext);
}
