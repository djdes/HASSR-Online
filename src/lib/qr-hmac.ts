import crypto from "node:crypto";

/**
 * Подпись коротких значений QR-страниц (пропуск после PIN, «запомнить
 * сотрудника»). Тот же секрет, что у QR-токенов оборудования; `scope`
 * разводит подписи разных назначений, чтобы одну нельзя было выдать за другую.
 */
function secret(): string {
  const raw = process.env.EQUIPMENT_QR_TOKEN_SECRET || process.env.TELEGRAM_LINK_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (!raw || raw.length < 16) throw new Error("EQUIPMENT_QR_TOKEN_SECRET не настроен (или слишком короткий).");
  return raw;
}

export function qrHmac(scope: string, payload: string): string {
  return crypto.createHmac("sha256", secret()).update(`${scope}:${payload}`).digest("base64url");
}

export function qrHmacEquals(signature: string, expected: string): boolean {
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
