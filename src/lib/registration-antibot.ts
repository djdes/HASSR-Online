import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Невидимая проверка от ботов для регистрации, формы на главной и заказа
 * без входа (спека invisible-antibot-2026-11). Человек ничего не отмечает:
 *   • `website` — скрытое поле-ловушка, человек его не видит и не заполняет;
 *   • `captchaToken` — подписанная сервером отметка времени, которую форма
 *     тихо получает при открытии (`GET /api/auth/registration-challenge`).
 *     Сервер примет её не раньше чем через 1,5 с после выдачи (бот, который
 *     сразу шлёт форму, не проходит) и не позже 12 часов.
 * Ключ подписи — `REGISTRATION_CHALLENGE_SECRET`, иначе `NEXTAUTH_SECRET`.
 * Сторонних сервисов (Google и т. п.) нет — проверка не зависит от их
 * доступности в РФ. Частоту по-прежнему ограничивают лимиты по IP.
 */
import { CHALLENGE_MAX_AGE_MS, CHALLENGE_MIN_AGE_MS } from "./registration-challenge-timing";

export { CHALLENGE_MAX_AGE_MS, CHALLENGE_MIN_AGE_MS };
const VERSION = "v1";

type Environment = Record<string, string | undefined>;
type Failure = { ok: false; status: 403 | 503; error: string };
type Result = { ok: true } | Failure;
type Dependencies = { env?: Environment; now?: number };

const rejected = (): Failure => ({
  ok: false,
  status: 403,
  error: "Не получилось отправить форму. Обновите страницу и попробуйте ещё раз.",
});
const unavailable = (): Failure => ({
  ok: false,
  status: 503,
  error: "Проверка перед регистрацией временно недоступна. Попробуйте позже.",
});

function signingKey(env: Environment): Buffer | null {
  const secret = (env.REGISTRATION_CHALLENGE_SECRET ?? env.NEXTAUTH_SECRET ?? "").trim();
  if (secret.length < 16) return null;
  // Отдельный ключ от NEXTAUTH_SECRET: подпись формы не годится ни для чего другого.
  return createHmac("sha256", secret).update("wesetup:registration-challenge").digest();
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Токен для формы; null — ключ подписи не настроен. */
export function issueRegistrationChallenge(dependencies: Dependencies = {}): { token: string } | null {
  const key = signingKey(dependencies.env ?? process.env);
  if (!key) return null;
  const payload = `${VERSION}.${dependencies.now ?? Date.now()}.${randomBytes(9).toString("base64url")}`;
  return { token: `${payload}.${sign(key, payload)}` };
}

/** Required before any registration side effects. There is no dev bypass. */
export async function verifyRegistrationChallenge(
  body: unknown,
  dependencies: Dependencies = {},
): Promise<Result> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return rejected();
  const input = body as Record<string, unknown>;
  // Optional for older API clients; if present, it must be an empty string.
  if (input.website !== undefined && input.website !== "") return rejected();
  const token = input.captchaToken;
  if (typeof token !== "string" || !token || token.length > 256) return rejected();
  const key = signingKey(dependencies.env ?? process.env);
  if (!key) return unavailable();

  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION || !/^\d{1,15}$/.test(parts[1])) return rejected();
  const expected = Buffer.from(sign(key, parts.slice(0, 3).join(".")));
  const actual = Buffer.from(parts[3]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return rejected();

  const age = (dependencies.now ?? Date.now()) - Number(parts[1]);
  // The same server issues and checks the stamp, so there is no clock skew.
  if (age < CHALLENGE_MIN_AGE_MS || age > CHALLENGE_MAX_AGE_MS) return rejected();
  return { ok: true };
}

/**
 * Та же невидимая проверка для заказа без входа (/order: оплата картой и
 * счёт по ИНН). Ответ — текст ошибки для покупателя или null, если прошёл.
 *
 * Если сама проверка недоступна (ключ подписи не задан), заказ пропускаем:
 * живой покупатель не должен упереться в сбой настройки. Вошедших
 * пользователей проверка не касается.
 */
export async function verifyGuestOrderChallenge(
  body: unknown,
  dependencies: Dependencies = {},
): Promise<{ status: 403; error: string } | null> {
  const result = await verifyRegistrationChallenge(body, dependencies);
  if (result.ok) return null;
  if (result.status === 503) {
    console.warn("[antibot] guest order challenge unavailable — order allowed");
    return null;
  }
  return { status: 403, error: "Не получилось отправить заказ. Обновите страницу и попробуйте ещё раз." };
}
