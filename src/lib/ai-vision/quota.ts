/**
 * Лимиты «Распознать с фото»: 20 распознаваний за сутки на сотрудника и 60
 * на организацию. Каждое распознавание — это прогон модели на подписке
 * владельца платформы, поэтому считаем по базе (журнал действий), а не в
 * памяти процесса: счётчик не обнуляется при выкладке.
 *
 * Сутки — скользящие 24 часа: без часовых поясов и «полуночных» всплесков.
 */

export const VISION_DAILY_LIMIT_USER = 20;
export const VISION_DAILY_LIMIT_ORG = 60;
export const VISION_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export type VisionUsage = { user: number; org: number };

export type VisionQuotaVerdict =
  | { ok: true; remainingUser: number; remainingOrg: number }
  | { ok: false; scope: "user" | "org"; error: string };

export function checkVisionQuota(
  usage: VisionUsage,
  limits: { user: number; org: number } = { user: VISION_DAILY_LIMIT_USER, org: VISION_DAILY_LIMIT_ORG }
): VisionQuotaVerdict {
  if (usage.user >= limits.user) {
    return {
      ok: false,
      scope: "user",
      error: `На сегодня распознавания закончились: не больше ${limits.user} в сутки на сотрудника. Введите строки вручную или попробуйте завтра.`,
    };
  }
  if (usage.org >= limits.org) {
    return {
      ok: false,
      scope: "org",
      error: `У организации закончились распознавания на сутки (${limits.org}). Введите строки вручную или попробуйте завтра.`,
    };
  }
  return { ok: true, remainingUser: limits.user - usage.user - 1, remainingOrg: limits.org - usage.org - 1 };
}
