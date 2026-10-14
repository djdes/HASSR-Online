"use client";

import { useMemo } from "react";
import { publicCopyFor } from "@/i18n/public-copy";
import { useSiteLocale } from "./site-locale-provider";

export function usePublicCopy() {
  const locale = useSiteLocale();
  return useMemo(() => publicCopyFor(locale), [locale]);
}
