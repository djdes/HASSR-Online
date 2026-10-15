"use client";
import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";

export function useComplaintCopy() {
  const t = useTranslations("complaintRegister");
  const locale = useLocale();
  const latest = useRef({ t, locale });
  useEffect(() => { latest.current = { t, locale }; }, [t, locale]);
  return { t, locale, latest };
}
