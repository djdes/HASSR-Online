"use client";

import { type ReactNode } from "react";
import { NextIntlClientProvider, useLocale } from "next-intl";
import type { SiteLocale } from "@/i18n/site-locale";
import type { Messages } from "@/i18n/messages";

export function SiteLocaleProvider({ locale, messages, timeZone, children }: { locale: SiteLocale; messages: Partial<Messages>; timeZone?: string; children: ReactNode }) {
  return <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>{children}</NextIntlClientProvider>;
}

export function useSiteLocale(): SiteLocale {
  return useLocale();
}
