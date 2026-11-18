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
  /**
   * Метка клика рекламы в адресе входа: `yclid` — Яндекс Директ, `gclid` —
   * Google Ads (спека visit-source-2026-11). Само значение не храним.
   */
  click?: "yclid" | "gclid";
};

export const SIGNUP_CHANNELS = [
  "yandex_direct",
  "google_ads",
  "utm",
  "search_yandex",
  "search_google",
  "search_bing",
  "search_mail",
  "search_other",
  "ai",
  "telegram",
  "vk",
  "max",
  "social",
  "site",
  "direct",
  "partner",
  "client_referral",
  "unknown",
] as const;

export type SignupChannel = (typeof SIGNUP_CHANNELS)[number];

export const SIGNUP_CHANNEL_LABELS: Record<SignupChannel, string> = {
  yandex_direct: "Яндекс Директ",
  google_ads: "Google Ads",
  utm: "Другая реклама (utm)",
  search_yandex: "Поиск Яндекса",
  search_google: "Поиск Google",
  search_bing: "Поиск Bing",
  search_mail: "Поиск Mail.ru",
  search_other: "Другой поисковик",
  ai: "ИИ-ассистент",
  telegram: "Telegram",
  vk: "ВКонтакте",
  max: "MAX",
  social: "Соцсети",
  site: "Другие сайты",
  direct: "Прямой заход",
  partner: "Партнёр",
  client_referral: "Рекомендация клиента",
  unknown: "Нет данных",
};

const FIELD_LIMITS: Record<Exclude<keyof SignupSourceSnapshot, "click">, number> = {
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
  const pick = (key: keyof typeof FIELD_LIMITS) =>
    typeof o[key] === "string" ? (o[key] as string).trim().slice(0, FIELD_LIMITS[key]) : "";
  const click = o.click === "yclid" || o.click === "gclid" ? o.click : null;
  return {
    place: pick("place"),
    landing: pick("landing"),
    referrer: pick("referrer"),
    utmSource: pick("utmSource"),
    utmMedium: pick("utmMedium"),
    utmCampaign: pick("utmCampaign"),
    ...(click ? { click } : {}),
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
const BING_HOST = /(^|\.)bing\.com$/;
const MAIL_SEARCH_HOST = /(^|\.)(go\.mail\.ru|search\.mail\.ru|mail\.ru)$/;
const OTHER_SEARCH_HOST = /(^|\.)(duckduckgo\.com|rambler\.ru|yahoo\.com|ecosia\.org|search\.brave\.com|startpage\.com|sputnik\.ru|nova\.rambler\.ru|qwant\.com|baidu\.com|naver\.com|yandex\.kz|yandex\.uz)$/;
/** ИИ-ассистенты: ответ со ссылкой на сайт — отдельный канал, не «другие сайты». */
const AI_HOST = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|claude\.ai|copilot\.microsoft\.com|chat\.deepseek\.com|deepseek\.com|giga\.chat|alice\.yandex\.ru|you\.com|phind\.com|poe\.com|grok\.com|chat\.mistral\.ai)$/;
const SOCIAL_HOST = /(^|\.)(instagram\.com|facebook\.com|fb\.com|ok\.ru|odnoklassniki\.ru|youtube\.com|youtu\.be|dzen\.ru|zen\.yandex\.ru|whatsapp\.com|wa\.me|x\.com|twitter\.com|t\.co|tiktok\.com|pinterest\.[a-z.]+|linkedin\.com|rutube\.ru|pikabu\.ru|reddit\.com|threads\.net)$/;

function channelFromUtm(source: string, medium: string): SignupChannel | null {
  const s = source.toLowerCase();
  const m = medium.toLowerCase();
  if (!s) return null;
  if (["yandex", "ya", "yandex_direct", "direct"].includes(s) && ["cpc", "ppc", "paid", "context"].includes(m)) {
    return "yandex_direct";
  }
  if (["google", "google_ads", "adwords"].includes(s) && ["cpc", "ppc", "paid"].includes(m)) return "google_ads";
  if (["chatgpt.com", "chatgpt", "openai", "perplexity", "perplexity.ai", "claude.ai", "gemini", "copilot", "deepseek"].includes(s)) return "ai";
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
  // Метка клика без utm — тоже реклама: автоматическая разметка Директа и Google Ads.
  if (source.click === "yclid") return "yandex_direct";
  if (source.click === "gclid") return "google_ads";
  const host = referrerHost(source.referrer);
  if (!host || OWN_HOST.test(host)) return "direct";
  // ИИ раньше Google: gemini.google.com — ассистент, а не поиск.
  if (AI_HOST.test(host)) return "ai";
  if (YANDEX_HOST.test(host)) return "search_yandex";
  if (GOOGLE_HOST.test(host)) return "search_google";
  if (BING_HOST.test(host)) return "search_bing";
  if (MAIL_SEARCH_HOST.test(host)) return "search_mail";
  if (OTHER_SEARCH_HOST.test(host)) return "search_other";
  if (TELEGRAM_HOST.test(host)) return "telegram";
  if (VK_HOST.test(host)) return "vk";
  if (MAX_HOST.test(host)) return "max";
  if (SOCIAL_HOST.test(host)) return "social";
  return "site";
}

/**
 * Коротко для уведомлений в Telegram (спека visit-source-2026-11):
 * «Поиск Яндекса», «Яндекс Директ · kafe_spb», «ИИ-ассистент · chatgpt.com».
 * Посадочную не пишем — она есть в полной сводке на карточке клиента.
 * Нет данных — `null`: строку не показываем.
 */
export function signupSourceShort(
  source: SignupSourceSnapshot | null,
  links: { partner?: boolean; clientReferral?: boolean } = {},
): string | null {
  const channel = signupChannel(source, links);
  if (channel === "unknown") return null;
  const label = SIGNUP_CHANNEL_LABELS[channel];
  if (!source || channel === "partner" || channel === "client_referral") return label;
  let detail: string | null = null;
  if (channel === "yandex_direct" || channel === "google_ads" || channel === "utm") {
    detail = source.utmCampaign || (channel === "utm" ? source.utmSource : "") || null;
  } else if (channel === "site" || channel === "social" || channel === "ai" || channel === "search_other") {
    detail = referrerHost(source.referrer);
  }
  return detail ? `${label} · ${detail.slice(0, 60)}` : label;
}

/** Одна строка для админа: канал и уточнение (кампания, сайт, посадочная). */
export function signupSourceSummary(source: SignupSourceSnapshot | null): string {
  const channel = signupChannel(source);
  const parts: string[] = [SIGNUP_CHANNEL_LABELS[channel]];
  if (source) {
    if (channel === "utm" || channel === "yandex_direct" || channel === "google_ads") {
      const utm = [source.utmSource, source.utmMedium, source.utmCampaign].filter(Boolean).join(" / ");
      if (utm) parts.push(utm);
    } else if (channel === "site" || channel === "social" || channel === "ai" || channel === "search_other") {
      const host = referrerHost(source.referrer);
      if (host) parts.push(host);
    }
    if (source.landing) parts.push(`вход: ${source.landing}`);
  }
  return parts.join(" · ");
}
