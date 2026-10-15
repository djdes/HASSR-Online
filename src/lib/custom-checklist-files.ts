import { knowledgeFileType, officeZipWithinLimits } from "./knowledge-documents";

export const CHECKLIST_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CHECKLIST_FILE_QUOTA_BYTES = 512 * 1024 * 1024;
export const CHECKLIST_FILE_PURPOSES = ["reference", "photo", "video", "audio"] as const;
export type ChecklistFilePurpose = (typeof CHECKLIST_FILE_PURPOSES)[number];
export function checklistAttachmentType(fileName: string, bytes: Uint8Array, purpose: ChecklistFilePurpose): string | null {
  if (!bytes.length || bytes.length > CHECKLIST_FILE_MAX_BYTES) return null;
  const extension = fileName.split(".").pop()?.toLowerCase();
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const starts = (...prefix: number[]) => prefix.every((value, index) => bytes[index] === value);
  const image = knowledgeFileType(fileName, bytes);
  const webp = extension === "webp" && text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  if ((purpose === "photo" || purpose === "reference") && (image === "image/png" || image === "image/jpeg" || webp)) return webp ? "image/webp" : image;
  const mp4 = bytes.length >= 16 && text(4, 8) === "ftyp";
  const webm = starts(0x1a, 0x45, 0xdf, 0xa3) && text(0, Math.min(1024, bytes.length)).toLowerCase().includes("webm");
  if ((purpose === "video" || purpose === "reference") && ((extension === "mp4" && mp4) || (extension === "webm" && webm))) return extension === "webm" ? "video/webm" : "video/mp4";
  if (purpose === "audio" || purpose === "reference") {
    if (extension === "mp3" && (text(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return "audio/mpeg";
    if (extension === "wav" && text(0, 4) === "RIFF" && text(8, 12) === "WAVE") return "audio/wav";
    if ((extension === "ogg" || extension === "oga") && text(0, 4) === "OggS") return "audio/ogg";
    if (extension === "m4a" && mp4) return "audio/mp4";
    if (extension === "webm" && webm) return "audio/webm";
  }
  if (purpose === "reference" && image && !image.startsWith("image/")) {
    if (["docx", "xlsx"].includes(extension ?? "") && !officeZipWithinLimits(bytes)) return null;
    return image;
  }
  return null;
}
export function checklistByteRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return "invalid";
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start ? { start, end } : "invalid";
}
