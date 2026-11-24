/**
 * Текст из DOCX без доверия к размерам, которые файл пишет о себе (2026-11-24,
 * свежая проверка R2-1): `word/document.xml` распаковывается `inflateRawSync`
 * с жёстким пределом выхода, поэтому «ZIP-бомба» с ложными размерами в
 * заголовках не раздувает память сервера. Им пользуются печатная ППК и
 * предпросмотр базы знаний. Только серверный код (node:zlib).
 */
import { inflateRawSync } from "node:zlib";

/** Предел распакованного `document.xml`: обычный документ — сотни килобайт. */
export const DOCX_XML_MAX_BYTES = 8 * 1024 * 1024;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Сырые байты XML части `name` (stored или deflate) не больше `limit`, иначе null. */
function zipEntry(bytes: Uint8Array, name: string, limit: number): Buffer | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Конец центрального каталога — в последних 64 КБ + 22 байта.
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === EOCD) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let index = 0; index < entries && offset + 46 <= bytes.length; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const entryName = Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLength)).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL) return null;
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const end = start + compressedSize;
    if (end > bytes.length) return null;
    const data = bytes.subarray(start, end);
    if (method === 0) return data.byteLength <= limit ? Buffer.from(data) : null;
    if (method !== 8) return null;
    try {
      // Предел выхода — сам inflate, а не размер из заголовка: ложь в заголовке не помогает.
      return inflateRawSync(data, { maxOutputLength: limit });
    } catch {
      return null;
    }
  }
  return null;
}

/** Текст абзацев DOCX; не DOCX, повреждён или слишком большой — null. */
export function docxPlainText(bytes: Uint8Array, limit = DOCX_XML_MAX_BYTES): string | null {
  const xml = zipEntry(bytes, "word/document.xml", limit);
  if (!xml) return null;
  return xml
    .toString("utf8")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .slice(0, 200_000);
}
