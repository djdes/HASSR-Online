export const KNOWLEDGE_MAX_BYTES = 25 * 1024 * 1024;
export const KNOWLEDGE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip,.rar,.7z";
export type KnowledgeDocumentItem = { id: string; title: string; fileName: string; mimeType: string; sizeBytes: number; uploadedByName: string; createdAt: string };

const TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
};
export function knowledgeFileType(fileName: string, bytes: Uint8Array): string | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ole = starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  const zip = starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06);
  const valid = (extension === "pdf" && starts(0x25, 0x50, 0x44, 0x46, 0x2d)) ||
    (["jpg", "jpeg"].includes(extension) && starts(0xff, 0xd8, 0xff)) ||
    (extension === "png" && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) ||
    (["doc", "xls"].includes(extension) && ole) ||
    (["docx", "xlsx", "zip"].includes(extension) && zip) ||
    (extension === "rar" && starts(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)) ||
    (extension === "7z" && starts(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c));
  return valid ? TYPES[extension] : null;
}

export function knowledgeInline(mimeType: string): boolean {
  return ["application/pdf", "image/jpeg", "image/png"].includes(mimeType);
}

/** Bound decompression before parsing office ZIP containers. Archives are never extracted. */
export function officeZipWithinLimits(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  let count = 0;
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    total += view.getUint32(offset + 24, true);
    count++;
    if (total > 20 * 1024 * 1024 || count > 1000) return false;
    offset += 45 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return count > 0;
}
