/**
 * Канал, из которого пришла регистрация (или заявка на показ), — по
 * снимку источника визита (`lib/signup-source.ts`: посадочная, referrer,
 * utm) и по привязкам организации (партнёр, рекомендация клиента).
 *
 * Чистый модуль: его читают воронка в ROOT, уведомление о заявке на показ
 * и тесты. Снимок пишется в `Organization.signupSourceJson` при
 * регистрации с формы; у регистраций до 01.11.2026 и созданных не через
 * форму (оплата гостем, приглашение) его нет — канал «нет данных».
 */

export type SignupSourceSnapshot = {
  place: string;
  landing: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};

export const SIGNUP_CHANNELS = [
  "yandex_direct",
  "utm",
  "search_yandex",
  "search_google",
  "telegram",
  "vk",
  "max",
  "site",
  "direct",
  "partner",
  "client_referral",
  "unknown",
] as const;

export type SignupChannel = (typeof SIGNUP_CHANNELS)[number];

export const SIGNUP_CHANNEL_LABELS: Record<SignupChannel, string> = {
  yandex_direct: "Яндекс Директ",
  utm: "Другая реклама (utm)",
  search_yandex: "Поиск Яндекса",
  search_google: "Поиск Google",
  telegram: "Telegram",
  vk: "ВКонтакте",
  max: "MAX",
  site: "Другие сайты",
  direct: "Прямой заход",
  partner: "Партнёр",
  client_referral: "Рекомендация клиента",
  unknown: "Нет данных",
};

const FIELD_LIMITS: Record<keyof SignupSourceSnapshot, number> = {
  place: 40,
  landing: 200,
  referrer: 500,
  utmSource: 200,
  utmMedium: 200,
  utmCampaign: 200,
};

/** Снимок из тела запроса или JSON-колонки: только строки, обрезанные по длине. */
export function readSignupSnapshot(raw: unknown): SignupSourceSnapshot {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (key: keyof SignupSourceSnapshot) =>
    typeof o[key] === "string" ? (o[key] as string).trim().slice(0, FIELD_LIMITS[key]) : "";
  return {
    place: pick("place"),
    landing: pick("landing"),
    referrer: pick("referrer"),
    utmSource: pick("utmSource"),
    utmMedium: pick("utmMedium"),
    utmCampaign: pick("utmCampaign"),
  };
}

/** Пустой снимок (ни посадочной, ни referrer, ни utm) хранить незачем. */
export function isEmptySnapshot(source: SignupSourceSnapshot): boolean {
  return Object.values(source).every((value) => value === "");
}

function referrerHost(referrer: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const OWN_HOST = /(^|\.)wesetup\.ru$|^localhost$|^127\.0\.0\.1$/;
const YANDEX_HOST = /(^|\.)(yandex\.[a-z.]+|ya\.ru)$/;
const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/;
const TELEGRAM_HOST = /(^|\.)(t\.me|telegram\.org|telegram\.me)$/;
const VK_HOST = /(^|\.)(vk\.com|vk\.ru|vkontakte\.ru)$/;
const MAX_HOST = /(^|\.)max\.ru$/;

function channelFromUtm(source: string, medium: string): SignupChannel | null {
  const s = source.toLowerCase();
  const m = medium.toLowerCase();
  if (!s) return null;
  if (["yandex", "ya", "yandex_direct", "direct"].includes(s) && ["cpc", "ppc", "paid", "context"].includes(m)) {
    return "yandex_direct";
  }
  if (["telegram", "tg"].includes(s)) return "telegram";
  if (["vk", "vkontakte"].includes(s)) return "vk";
  if (s === "max") return "max";
  return "utm";
}

/**
 * Канал регистрации. Привязки организации важнее снимка: клиент партнёра —
 * «Партнёр», даже если пришёл из поиска по его ссылке.
 */
export function signupChannel(
  source: SignupSourceSnapshot | null,
  links: { partner?: boolean; clientReferral?: boolean } = {},
): SignupChannel {
  if (links.partner) return "partner";
  if (links.clientReferral) return "client_referral";
  if (!source || isEmptySnapshot(source)) return "unknown";
  const byUtm = channelFromUtm(source.utmSource, source.utmMedium);
  if (byUtm) return byUtm;
  const host = referrerHost(source.referrer);
  if (!host || OWN_HOST.test(host)) return "direct";
  if (YANDEX_HOST.test(host)) return "search_yandex";
  if (GOOGLE_HOST.test(host)) return "search_google";
  if (TELEGRAM_HOST.test(host)) return "telegram";
  if (VK_HOST.test(host)) return "vk";
  if (MAX_HOST.test(host)) return "max";
  return "site";
}

/** Одна строка для админа: канал и уточнение (кампания, сайт, посадочная). */
export function signupSourceSummary(source: SignupSourceSnapshot | null): string {
  const channel = signupChannel(source);
  const parts: string[] = [SIGNUP_CHANNEL_LABELS[channel]];
  if (source) {
    if (channel === "utm" || channel === "yandex_direct") {
      const utm = [source.utmSource, source.utmMedium, source.utmCampaign].filter(Boolean).join(" / ");
      if (utm) parts.push(utm);
    } else if (channel === "site") {
      const host = referrerHost(source.referrer);
      if (host) parts.push(host);
    }
    if (source.landing) parts.push(`вход: ${source.landing}`);
  }
  return parts.join(" · ");
}
