/**
 * Клиент-безопасная часть вложений поддержки: типы и константы, которые
 * нужны виджетам (браузеру). Серверная логика (fs, crypto, подпись) — в
 * `support-attachments.ts`; он импортирует типы отсюда, а не наоборот,
 * чтобы виджет не тянул node-модули в бандл.
 */

export const SUPPORT_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_MAX_COUNT = 5;

export type SupportAttachmentMeta = {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type SignedAttachment = SupportAttachmentMeta & { sig: string };

export function isImageAttachment(meta: {
  mimeType: string;
}): boolean {
  return meta.mimeType.startsWith("image/");
}

export function formatBytes(size: number, locale: "ru" | "en" | "uz" = "ru"): string {
  const intlLocale = locale === "uz" ? "uz-Latn" : locale;
  const format = (
    value: number,
    unit: "byte" | "kilobyte" | "megabyte",
    fractionDigits: number,
  ) =>
    new Intl.NumberFormat(intlLocale, {
      style: "unit",
      unit,
      unitDisplay: "short",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);

  if (size >= 1024 * 1024) return format(size / (1024 * 1024), "megabyte", 1);
  if (size >= 1024) return format(Math.round(size / 1024), "kilobyte", 0);
  return format(size, "byte", 0);
}
