import crypto from "node:crypto";

/**
 * Пропуск после ввода PIN на HTML-форме QR: PIN проверяется один раз на
 * своём шаге, дальше 15 минут действует подписанная HttpOnly-cookie,
 * привязанная к сотруднику. Сам PIN в форме и в адресе не повторяется.
 */
const PIN_PASS_TTL_MS = 15 * 60 * 1000;

function secret(): string {
  const raw = process.env.EQUIPMENT_QR_TOKEN_SECRET || process.env.TELEGRAM_LINK_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (!raw || raw.length < 16) throw new Error("EQUIPMENT_QR_TOKEN_SECRET не настроен (или слишком короткий).");
  return raw;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(`pin-pass:${payload}`).digest("base64url");
}

export function mintPinPass(employeeId: string, now: number = Date.now()): string {
  const payload = `${employeeId}.${now + PIN_PASS_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyPinPass(value: string | null | undefined, employeeId: string, now: number = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [id, expRaw, signature] = parts;
  const exp = Number(expRaw);
  if (id !== employeeId || !Number.isFinite(exp) || exp < now) return false;
  const expected = sign(`${id}.${expRaw}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const PIN_PASS_COOKIE = "wesetup.qr.pin";
export const PIN_PASS_MAX_AGE_SEC = PIN_PASS_TTL_MS / 1000;
