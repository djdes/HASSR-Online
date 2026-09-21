import { db } from "@/lib/db";

/**
 * Passkey (WebAuthn): настоящий Face ID / отпечаток на собственном телефоне
 * сотрудника.
 *
 * Relying Party — домен сайта. Приватный ключ живёт в устройстве, у нас —
 * только публичный ключ и счётчик. Challenge одноразовый, 5 минут: без
 * него ответ аутентификатора можно было бы переиграть.
 */

export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function siteUrl(): URL {
  const raw = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "https://wesetup.ru";
  try {
    return new URL(raw);
  } catch {
    return new URL("https://wesetup.ru");
  }
}

/** rpID — хост без порта (`wesetup.ru`; на стенде `localhost`). */
export function webAuthnRpId(): string {
  return siteUrl().hostname;
}

/** Ожидаемый origin — схема + хост (+ порт на стенде). */
export function webAuthnOrigin(): string {
  return siteUrl().origin;
}

export const WEBAUTHN_RP_NAME = "WeSetup";

export async function storeWebAuthnChallenge(params: {
  userId: string | null;
  challenge: string;
  kind: "register" | "authenticate";
}): Promise<string> {
  const row = await db.webAuthnChallenge.create({
    data: {
      userId: params.userId,
      challenge: params.challenge,
      kind: params.kind,
      expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Забрать challenge по id, одноразово. null — нет, просрочен или уже
 * использован. Одноразовость через updateMany с фильтром consumedAt=null.
 */
export async function consumeWebAuthnChallenge(
  id: string,
  kind: "register" | "authenticate",
): Promise<{ challenge: string; userId: string | null } | null> {
  const row = await db.webAuthnChallenge.findUnique({ where: { id } });
  if (!row || row.kind !== kind || row.consumedAt || row.expiresAt.getTime() < Date.now()) return null;
  const consumed = await db.webAuthnChallenge.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) return null;
  return { challenge: row.challenge, userId: row.userId };
}

/** Подпись устройства из User-Agent — для списка ключей в профиле. */
export function deviceLabelFromUserAgent(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) return "Android";
  if (/Macintosh/i.test(s)) return "Mac";
  if (/Windows/i.test(s)) return "Windows";
  return "Устройство";
}

const B64URL = /^[A-Za-z0-9_-]+$/;
export function isBase64Url(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && B64URL.test(s);
}
