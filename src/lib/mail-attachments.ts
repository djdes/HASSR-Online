export const MAIL_ATTACHMENT_LIMIT = 10;
export const MAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export type MailAttachmentInfo = { filename: string; size: number; contentType: string };

const TYPES: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
  zip: "application/zip", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", mov: "video/quicktime",
};
export const MAIL_ATTACHMENT_ACCEPT = Object.keys(TYPES).map(ext => `.${ext}`).join(",");

export function mailAttachmentType(filename: string): string | null {
  if (!filename || filename.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(filename) || filename !== filename.trim()) return null;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(TYPES, extension) ? TYPES[extension] : null;
}

/** Identical browser/server bounds; transport MIME is derived from the filename, never a path/URL. */
export function mailAttachmentError(files: readonly { name: string; size: number }[]): "count" | "size" | "type" | null {
  if (files.length > MAIL_ATTACHMENT_LIMIT) return "count";
  if (files.some(file => !Number.isSafeInteger(file.size) || file.size < 1) || files.reduce((sum, file) => sum + file.size, 0) > MAIL_ATTACHMENT_BYTES) return "size";
  if (files.some(file => !mailAttachmentType(file.name))) return "type";
  return null;
}

export function mailAttachmentInfo(value: unknown): MailAttachmentInfo[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MailAttachmentInfo => Boolean(item && typeof item === "object" && typeof item.filename === "string" && typeof item.size === "number" && typeof item.contentType === "string"));
}
