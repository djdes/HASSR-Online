import { createHash, randomInt } from "node:crypto";

/**
 * Код подтверждения входа — чистые правила. Шесть цифр, пять минут,
 * пять попыток. Хеш кода солится id челленджа: утечка таблицы не даёт
 * подобрать код по радужной таблице из миллиона шестизначных чисел.
 */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Вид сообщения с кодом входа в Telegram — срочный, тихие часы его не держат. */
export const LOGIN_CODE_DELIVERY_KIND = "auth.login-code";
export const CHALLENGE_MAX_ATTEMPTS = 5;

export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashLoginCode(code: string, challengeId: string): string {
  return createHash("sha256").update(`${challengeId}:${code.trim()}`).digest("hex");
}

export type ChallengeVerdict = "ok" | "expired" | "consumed" | "too-many" | "mismatch";

export const CHALLENGE_MESSAGES: Record<Exclude<ChallengeVerdict, "ok">, string> = {
  expired: "Код устарел — войдите заново, пришлём новый",
  consumed: "Этот код уже использован — войдите заново",
  "too-many": "Слишком много попыток — войдите заново, пришлём новый код",
  mismatch: "Неверный код",
};

export function evaluateChallenge(
  challenge: { id: string; codeHash: string; expiresAt: Date; attempts: number; consumedAt: Date | null },
  input: { code: string; now: Date }
): ChallengeVerdict {
  if (challenge.consumedAt) return "consumed";
  if (input.now > challenge.expiresAt) return "expired";
  if (challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) return "too-many";
  const normalized = input.code.replace(/\D/g, "");
  if (normalized.length !== 6) return "mismatch";
  return hashLoginCode(normalized, challenge.id) === challenge.codeHash ? "ok" : "mismatch";
}
