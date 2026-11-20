import { blankChallengeConfig, verifyBlankChallenge } from "@/lib/blank-recaptcha.server";
import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { verifyRegistrationChallenge } from "@/lib/registration-antibot";

/**
 * Проверка от ботов перед скачиванием шаблона (спека
 * blank-download-seal-cover-captcha-2026-11-20): Google reCAPTCHA — только
 * подозрительным. Владелец: виджет занимал место, снижал конверсию, живые люди
 * не могли его пройти.
 *
 * Без Google пропускаем, когда всё сходится:
 *   • `stamp` — подписанная сервером отметка времени, та же, что у регистрации
 *     (`registration-antibot.ts`): окно тихо берёт её при открытии, сервер
 *     принимает не раньше чем через 1,5 с после выдачи;
 *   • браузер похож на браузер (`suspiciousUserAgent`): атака 18.11 шла с одной
 *     подписью браузера в кавычках;
 *   • не больше 5 скачиваний без проверки в час с одного адреса и 40 за
 *     10 минут по всему сайту — волну с разных адресов тоже ловим.
 * Иначе — `captcha_required`: окно показывает виджет, человек отмечает «Я не
 * робот» и жмёт «Скачать» ещё раз (с `captchaToken` — проверка Google, как
 * раньше). Ловушку `website`, лимиты и проверку почты роут делает сам.
 */

export const BLANK_FREE_LIMITS = { perIpPerHour: 5, sitewidePerTenMinutes: 40 } as const;

const AUTOMATION_RE =
  /headless|phantomjs|selenium|webdriver|puppeteer|playwright|python|curl\/|wget|go-http-client|node-fetch|undici|axios|okhttp|java\/|libwww|httpclient|scrapy|postman/i;

/** Браузер не похож на настоящий: пусто, кавычки (атака 18.11), не «Mozilla/5.0 …», признаки скрипта. */
export function suspiciousUserAgent(userAgent: string | null | undefined): boolean {
  const value = (userAgent ?? "").trim();
  if (value.length < 20 || value.length > 512) return true;
  if (/["']/.test(value)) return true;
  if (!value.startsWith("Mozilla/5.0 ")) return true;
  return AUTOMATION_RE.test(value);
}

type Environment = Record<string, string | undefined>;

export type BlankGateResult =
  | { ok: true; via: "invisible" | "captcha" }
  | {
      ok: false;
      status: 403 | 503;
      errorCode: "captcha_required" | "captcha" | "captcha_unavailable";
      error: string;
    };

const REQUIRED = "Подтвердите, что вы не робот, и нажмите «Скачать» ещё раз.";
const UNAVAILABLE = "Проверка перед скачиванием временно недоступна. Попробуйте позже.";

export function createBlankChallengeGate(
  limits: { perIpPerHour: number; sitewidePerTenMinutes: number } = BLANK_FREE_LIMITS,
) {
  const perIp: RateLimiter = createRateLimiter({ tokensPerInterval: limits.perIpPerHour, intervalMs: 60 * 60 * 1000 });
  const sitewide: RateLimiter = createRateLimiter({ tokensPerInterval: limits.sitewidePerTenMinutes, intervalMs: 10 * 60 * 1000 });

  /** Скачивание без Google: съедает попытку из обоих порогов или не трогает ни одного. */
  function freePass(ip: string): boolean {
    const ipKey = `blank:free:${ip}`;
    if (!perIp.consume(ipKey)) return false;
    if (sitewide.consume("blank:free:all")) return true;
    perIp.refund(ipKey);
    return false;
  }

  return async function checkBlankChallenge(
    body: unknown,
    context: { ip: string; userAgent: string | null },
    dependencies: { env?: Environment; fetch?: typeof fetch; now?: number } = {},
  ): Promise<BlankGateResult> {
    const input = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const env = dependencies.env ?? process.env;

    // Человек уже отметил «Я не робот» — проверка Google, как раньше.
    if (typeof input.captchaToken === "string" && input.captchaToken.trim()) {
      const result = await verifyBlankChallenge(input, { env, fetch: dependencies.fetch });
      if (result.ok) return { ok: true, via: "captcha" };
      return {
        ok: false,
        status: result.status,
        errorCode: result.status === 503 ? "captcha_unavailable" : "captcha",
        error: result.error,
      };
    }

    const stamp = await verifyRegistrationChallenge(
      { website: input.website ?? "", captchaToken: input.stamp },
      { env, now: dependencies.now },
    );
    if (stamp.ok && !suspiciousUserAgent(context.userAgent) && freePass(context.ip)) {
      return { ok: true, via: "invisible" };
    }
    // Нужна проверка Google, а ключей нет — не пускаем (как раньше).
    if (!blankChallengeConfig(env)) {
      return { ok: false, status: 503, errorCode: "captcha_unavailable", error: UNAVAILABLE };
    }
    return { ok: false, status: 403, errorCode: "captcha_required", error: REQUIRED };
  };
}

/** Один на процесс (как остальные лимиты сайта — PM2 держит один инстанс). */
export const checkBlankChallenge = createBlankChallengeGate();
