"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";

export function useBreakdownCopy() {
  const locale = useLocale();
  const t = useTranslations("breakdownHistory");
  const latest = useRef({ t, locale });
  useEffect(() => { latest.current = { t, locale }; }, [t, locale]);
  return { t, locale, latest };
}
