"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";

export function useAccidentCopy() {
  const t = useTranslations("accidentJournal");
  const locale = useLocale() as Locale;
  const latest = useRef({ t, locale });
  useEffect(() => { latest.current = { t, locale }; }, [t, locale]);
  return { t, locale, latest };
}
