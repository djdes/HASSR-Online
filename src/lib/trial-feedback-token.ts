import crypto from "node:crypto";

/**
 * Подписанная ссылка из письма «Удалось оценить электронные журналы?»
 * (спека trial-emails-rename-2026-11): организация, владелец и срок (60 дней).
 * HMAC-SHA256 на ключе из NEXTAUTH_SECRET со своей меткой — токен отзыва не
 * подходит ни к какой другой ссылке сайта.
 */

export const TRIAL_FEEDBACK_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

type Claims = { v: 1; o: string; u: string; x: number };

function key(): Buffer {
  const raw = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) throw new Error("NEXTAUTH_SECRET не настроен — ссылку отзыва подписать нечем");
  return crypto.createHmac("sha256", raw).update("wesetup:trial-feedback:v1").digest();
}

function sign(body: string): string {
  return crypto.createHmac("sha256", key()).update(body).digest("base64url");
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function signTrialFeedbackToken(params: { organizationId: string; userId: string }, now = Date.now()): string {
  const claims: Claims = { v: 1, o: params.organizationId, u: params.userId, x: Math.floor((now + TRIAL_FEEDBACK_TOKEN_TTL_MS) / 1000) };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyTrialFeedbackToken(
  token: string | null | undefined,
  now = Date.now(),
): { organizationId: string; userId: string } | null {
  if (!token || token.length > 600) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Claims>;
    if (claims.v !== 1 || typeof claims.o !== "string" || typeof claims.u !== "string" || typeof claims.x !== "number") return null;
    if (!ID_RE.test(claims.o) || !ID_RE.test(claims.u)) return null;
    if (claims.x * 1000 < now) return null;
    return { organizationId: claims.o, userId: claims.u };
  } catch {
    return null;
  }
}

/** Адрес кнопки письма: страница с выбранным ответом (запись — только по «Отправить»). */
export function trialFeedbackHref(token: string, answer: string): string {
  return `/trial-feedback?t=${encodeURIComponent(token)}&a=${encodeURIComponent(answer)}`;
}
