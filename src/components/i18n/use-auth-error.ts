"use client";

import { useLocale, useTranslations } from "next-intl";
import { legacyAuthErrorKey } from "@/i18n/legacy-auth-errors";

/** Compatibility for known old API error strings until every producer emits
 * stable codes. Unknown server details never become translation keys. */
export function useAuthError() {
  const locale = useLocale();
  const t = useTranslations("auth.apiErrors");
  return (message: unknown, fallback: string): string => {
    const key = legacyAuthErrorKey(message);
    if (key) return t(key, { minutes: 5 });
    return locale === "ru" && typeof message === "string" && message.trim() ? message : fallback;
  };
}
