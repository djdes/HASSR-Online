/**
 * Подпись пальцем на экране (лист ознакомления 3.7, 2026-11-24): картинка PNG
 * из `canvas.toDataURL("image/png")`. Сервер проверяет, что это PNG разумного
 * размера, и хранит байты в отметке ознакомления.
 */
export const SIGNATURE_MAX_BYTES = 300 * 1024;
/** Пустой холст 600×200 — около 1–2 КБ; меньше этого подписи нет. */
const SIGNATURE_MIN_BYTES = 120;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PREFIX = "data:image/png;base64,";

export type ParsedSignature =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }
  | { ok: false; error: string };

/** data:image/png;base64,… → байты PNG; не PNG, пусто, слишком большая — ошибка. */
export function parseSignatureDataUrl(value: unknown): ParsedSignature {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return { ok: false, error: "Подпись должна быть картинкой PNG" };
  const base64 = value.slice(PREFIX.length);
  if (base64.length > Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    return { ok: false, error: "Подпись слишком большая" };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > SIGNATURE_MAX_BYTES) return { ok: false, error: "Подпись слишком большая" };
  if (bytes.length < SIGNATURE_MIN_BYTES || !PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return { ok: false, error: "Распишитесь пальцем в поле подписи" };
  }
  // IHDR: ширина и высота — байты 16–23.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 20 || height < 20 || width > 4000 || height > 4000) return { ok: false, error: "Подпись должна быть картинкой PNG" };
  // Копия в своём ArrayBuffer: поле Bytes в Prisma принимает именно его.
  return { ok: true, bytes: new Uint8Array(bytes), width, height };
}

/** Способ отметки для листа: подпись, PIN-код или в своём кабинете. */
export type AckMethod = "self" | "pin" | "finger";

export function ackMethodOf(method: string | null | undefined, hasSignature: boolean): AckMethod {
  if (hasSignature || method === "finger") return "finger";
  if (method === "pin") return "pin";
  return "self";
}
