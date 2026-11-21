import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Токен подписи журнала УКЭП (спека journal-ukep-signing-2026-11-21, Р2).
 * Сервер выдаёт PDF документа и токен: документ, пользователь, организация,
 * SHA-256 этого PDF и срок. Браузер подписывает PDF и присылает его обратно с
 * подписью и токеном — так сервер знает, что подписан ровно тот PDF, который он
 * собрал для этого человека, и не хранит черновик между шагами.
 */

export const UKEP_TOKEN_TTL_MS = 15 * 60 * 1000;

export type UkepTokenClaims = { documentId: string; userId: string; organizationId: string; sha256: string };

type Payload = UkepTokenClaims & { exp: number };

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`ukep:${body}`).digest("base64url");
}

export function signUkepToken(claims: UkepTokenClaims, secret: string, now: Date = new Date()): string {
  const payload: Payload = { ...claims, exp: now.getTime() + UKEP_TOKEN_TTL_MS };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${mac(body, secret)}`;
}

export function verifyUkepToken(
  token: string,
  secret: string,
  expected: UkepTokenClaims,
  now: Date = new Date(),
): { ok: true } | { ok: false; error: string } {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return { ok: false, error: "Подпись устарела — начните подписание заново" };
  const want = Buffer.from(mac(body, secret));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, error: "Подпись устарела — начните подписание заново" };
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return { ok: false, error: "Подпись устарела — начните подписание заново" };
  }
  if (typeof payload.exp !== "number" || payload.exp < now.getTime()) {
    return { ok: false, error: "Прошло больше 15 минут — начните подписание заново" };
  }
  if (
    payload.documentId !== expected.documentId ||
    payload.userId !== expected.userId ||
    payload.organizationId !== expected.organizationId
  ) {
    return { ok: false, error: "Подпись начата для другого документа — начните заново" };
  }
  if (payload.sha256 !== expected.sha256) return { ok: false, error: "PDF изменён после подготовки — начните заново" };
  return { ok: true };
}

/** Секрет — тот же, что у сессий: отдельного ключа заводить не нужно. */
export function ukepSecret(env: { NEXTAUTH_SECRET?: string } = process.env): string | null {
  const secret = env.NEXTAUTH_SECRET?.trim();
  return secret ? secret : null;
}
