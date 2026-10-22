"use client";

import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatBytes } from "@/lib/support-attachments-shared";

/** This node resolves copy under the still-mounted ROOT Toaster, even after its card unmounts. */
export function RootUploadFailure() {
  const t = useTranslations("publicSupport");
  return <>{t("attachment.uploadFailed")}</>;
}

export function getRootUploadFailureContent() {
  return <RootUploadFailure />;
}

/** ROOT-only finite Uzbek unit profile; the shared/default callers remain unchanged. */
export function formatRootAttachmentBytes(size: number, locale: Locale): string {
  if (locale !== "uz" || !Number.isFinite(size)) return formatBytes(size, locale);
  const megabytes = size >= 1024 * 1024;
  const kilobytes = size >= 1024 && !megabytes;
  const value = megabytes ? size / (1024 * 1024) : kilobytes ? Math.round(size / 1024) : size;
  const digits = megabytes ? 1 : 0;
  const number = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value).replaceAll(",", "\u00a0").replace(".", ",");
  return `${number} ${megabytes ? "MB" : kilobytes ? "kB" : "bayt"}`;
}
