import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

/**
 * Лимиты скачивания шаблонов (POST /api/public/blank-download).
 *
 *   • 30 скачиваний в час с одного адреса — живому человеку с запасом (весь
 *     каталог за вечер), а скрипт, собирающий почты, упирается сразу;
 *   • 50 в сутки на одну почту — столько же с запасом, но чужую почту не
 *     завалить скачиваниями из разных сетей;
 *   • письмо со ссылками — не больше 10 в сутки на почту: файл скачивается
 *     и дальше, но ящик жертвы не превратить в мишень для рассылки.
 */
export const BLANK_LIMITS = {
  perIpPerHour: 30,
  perEmailPerDay: 50,
  emailsPerDay: 10,
} as const;

export type BlankDownloadLimiter = {
  /** Съесть попытку: `null` — можно, иначе кто упёрся и через сколько секунд повторить. */
  consume(ip: string, email: string): { scope: "ip" | "email"; retryAfterSec: number } | null;
  /** Можно ли сейчас отправить письмо на эту почту (съедает письмо). */
  consumeEmail(email: string): boolean;
};

export function createBlankDownloadLimiter(
  limits: { perIpPerHour: number; perEmailPerDay: number; emailsPerDay: number } = BLANK_LIMITS,
): BlankDownloadLimiter {
  const byIp: RateLimiter = createRateLimiter({ tokensPerInterval: limits.perIpPerHour, intervalMs: 60 * 60 * 1000 });
  const byEmail: RateLimiter = createRateLimiter({
    tokensPerInterval: limits.perEmailPerDay,
    intervalMs: 24 * 60 * 60 * 1000,
  });
  const letters: RateLimiter = createRateLimiter({ tokensPerInterval: limits.emailsPerDay, intervalMs: 24 * 60 * 60 * 1000 });

  const retryAfter = (limiter: RateLimiter, key: string) => Math.max(1, Math.ceil(limiter.remainingMs(key) / 1000));

  return {
    consume(ip, email) {
      const ipKey = `blank:ip:${ip}`;
      const emailKey = `blank:email:${email}`;
      if (!byIp.consume(ipKey)) return { scope: "ip", retryAfterSec: retryAfter(byIp, ipKey) };
      if (!byEmail.consume(emailKey)) {
        // Попытка не состоялась — лимит адреса не тратим.
        byIp.refund(ipKey);
        return { scope: "email", retryAfterSec: retryAfter(byEmail, emailKey) };
      }
      return null;
    },
    consumeEmail(email) {
      return letters.consume(`blank:letter:${email}`);
    },
  };
}

/** Один на процесс (как остальные лимиты сайта — PM2 держит один инстанс). */
export const blankDownloadLimiter = createBlankDownloadLimiter();
