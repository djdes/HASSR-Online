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

export function formatBytes(size: number, locale: "ru" | "en" = "ru"): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} ${locale === "en" ? "MB" : "МБ"}`;
  if (size >= 1024) return `${Math.round(size / 1024)} ${locale === "en" ? "KB" : "КБ"}`;
  return `${size} ${locale === "en" ? "B" : "Б"}`;
}
