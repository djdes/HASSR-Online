import crypto from "node:crypto";

/**
 * Токен получателя рассылки — `<id>.<подпись>`. По нему работают отписка
 * (`/unsubscribe/<token>`) и клики (`/r/<token>/<n>`).
 *
 * Подпись — HMAC-SHA256 от id с секретом сервера: подобрать чужой токен
 * перебором id нельзя, и мусор отсекается без запроса в базу. Секрет —
 * `MAILING_TOKEN_SECRET`, иначе `NEXTAUTH_SECRET` (смена секрета
 * отключит ссылки из уже отправленных писем).
 */

const SCOPE = "mailing-recipient";
const SIGNATURE_LENGTH = 22; // 132 бита base64url

function tokenSecret(explicit?: string): string {
  const raw = explicit ?? process.env.MAILING_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  if (raw.length < 16) {
    throw new Error("[mailing] MAILING_TOKEN_SECRET/NEXTAUTH_SECRET не настроен или короче 16 символов");
  }
  return raw;
}

function signature(id: string, secret?: string): string {
  return crypto
    .createHmac("sha256", tokenSecret(secret))
    .update(`${SCOPE}:${id}`)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);
}

/** id получателя — наш, случайный: токен считается до записи в базу. */
export function newRecipientId(): string {
  return `mr${crypto.randomBytes(10).toString("hex")}`;
}

export function signRecipientToken(id: string, secret?: string): string {
  return `${id}.${signature(id, secret)}`;
}

/** id получателя, если подпись верна; иначе null. */
export function verifyRecipientToken(token: string | null | undefined, secret?: string): string | null {
  const value = (token ?? "").trim();
  if (value.length > 120) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || sig.length !== SIGNATURE_LENGTH) return null;
  let expected: string;
  try {
    expected = signature(id, secret);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}
