import { isValidTime, type DigestSchedule, type DigestWeekday } from "./schedule";

/**
 * Настройки и шаблон ИИ-сводки администратору — редактирует ROOT во
 * вкладке «ИИ-сводка» раздела «Рассылка». Хранятся в `PlatformSetting`
 * (`mailing.aiDigest.config`). Чистый модуль: его читают и форма в
 * браузере, и сервер.
 */

export const AI_DIGEST_CHANNELS = ["email", "telegram", "max"] as const;
export type AiDigestChannel = (typeof AI_DIGEST_CHANNELS)[number];

export const AI_DIGEST_CHANNEL_LABELS: Record<AiDigestChannel, string> = {
  email: "Почта — полная сводка",
  telegram: "Telegram — коротко",
  max: "MAX — коротко",
};

export const AI_DIGEST_SECTIONS = ["sales", "avgCheck", "tariffs", "mailings", "campaigns", "recommendations"] as const;
export type AiDigestSection = (typeof AI_DIGEST_SECTIONS)[number];

export const AI_DIGEST_SECTION_LABELS: Record<AiDigestSection, string> = {
  sales: "Продажи: выручка и оплаты против прошлой недели",
  avgCheck: "Средний чек: изменение и причины",
  tariffs: "Продажи по тарифам",
  mailings: "Рассылки: отправлено, клики, отписки против прошлой недели",
  campaigns: "Кампании недели",
  recommendations: "Рекомендации ИИ: как поднять средний чек",
};

export type AiDigestConfig = {
  enabled: boolean;
  schedule: DigestSchedule;
  channels: Record<AiDigestChannel, boolean>;
  /** Тема письма, с переменными. */
  emailSubject: string;
  /** Вступление письма (перед цифрами), с переменными. */
  emailIntro: string;
  sections: Record<AiDigestSection, boolean>;
  /** Сколько рекомендаций просить у ИИ. */
  recommendationsCount: number;
  /** Дополнительные указания ИИ: на что смотреть, каким тоном писать. */
  aiInstructions: string;
  /** Сильно сокращённый текст для Telegram и MAX, с переменными. */
  shortTemplate: string;
};

/** Переменные шаблона: подставляются и в тему, и во вступление, и в короткий текст. */
export const AI_DIGEST_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "period", label: "неделя, 17.11–23.11.2026" },
  { key: "revenue", label: "выручка недели" },
  { key: "revenueDelta", label: "изменение выручки, %" },
  { key: "orders", label: "число оплат" },
  { key: "ordersDelta", label: "изменение числа оплат" },
  { key: "avgCheck", label: "средний чек" },
  { key: "avgCheckDelta", label: "изменение среднего чека" },
  { key: "mailingsSent", label: "сообщений рассылок отправлено" },
  { key: "mailingsDelta", label: "изменение отправок" },
  { key: "clicks", label: "кликов из рассылок" },
  { key: "ctr", label: "доля кликнувших" },
  { key: "unsubscribes", label: "отписок" },
  { key: "campaigns", label: "кампаний запущено" },
  { key: "aiSummary", label: "вывод ИИ в 1–3 предложения" },
  { key: "topTip", label: "главная рекомендация ИИ" },
];

export const AI_DIGEST_SUBJECT_MAX = 150;
export const AI_DIGEST_INTRO_MAX = 2000;
export const AI_DIGEST_INSTRUCTIONS_MAX = 3000;
export const AI_DIGEST_SHORT_MAX = 1500;

export const DEFAULT_AI_DIGEST_CONFIG: AiDigestConfig = {
  enabled: true,
  schedule: { weekday: 7, time: "23:59" },
  channels: { email: true, telegram: true, max: true },
  emailSubject: "Итоги недели {period}: выручка {revenue} ({revenueDelta})",
  emailIntro: "Сводка WeSetup за неделю {period} — продажи и рассылки в сравнении с прошлой неделей.\n\n{aiSummary}",
  sections: { sales: true, avgCheck: true, tariffs: true, mailings: true, campaigns: true, recommendations: true },
  recommendationsCount: 3,
  aiInstructions:
    "Пиши коротко и по делу, для владельца сервиса. Рекомендации — конкретные действия на ближайшую неделю, " +
    "которые реально выполнить: апсейл на годовой тариф и «Премиум», пакеты с оборудованием, рассылки по сегментам.",
  shortTemplate: [
    "📊 Неделя {period}",
    "Выручка: {revenue} ({revenueDelta})",
    "Оплат: {orders} ({ordersDelta}), средний чек {avgCheck} ({avgCheckDelta})",
    "Рассылки: {mailingsSent} сообщ., кликов {clicks}",
    "💡 {topTip}",
    "Полная сводка — на почте.",
  ].join("\n"),
};

function str(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").slice(0, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Что угодно из базы или запроса → полный конфиг (недостающее — по умолчанию). */
export function normalizeAiDigestConfig(raw: unknown): AiDigestConfig {
  const d = DEFAULT_AI_DIGEST_CONFIG;
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const s = r.schedule && typeof r.schedule === "object" ? (r.schedule as Record<string, unknown>) : {};
  const c = r.channels && typeof r.channels === "object" ? (r.channels as Record<string, unknown>) : {};
  const sec = r.sections && typeof r.sections === "object" ? (r.sections as Record<string, unknown>) : {};
  const weekday = Number(s.weekday);
  const time = typeof s.time === "string" && isValidTime(s.time) ? s.time : d.schedule.time;
  const count = Number(r.recommendationsCount);
  return {
    enabled: bool(r.enabled, d.enabled),
    schedule: {
      weekday: (Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 ? weekday : d.schedule.weekday) as DigestWeekday,
      time,
    },
    channels: {
      email: bool(c.email, d.channels.email),
      telegram: bool(c.telegram, d.channels.telegram),
      max: bool(c.max, d.channels.max),
    },
    emailSubject: str(r.emailSubject, AI_DIGEST_SUBJECT_MAX * 2, d.emailSubject),
    emailIntro: str(r.emailIntro, AI_DIGEST_INTRO_MAX * 2, d.emailIntro),
    sections: Object.fromEntries(AI_DIGEST_SECTIONS.map((key) => [key, bool(sec[key], d.sections[key])])) as Record<
      AiDigestSection,
      boolean
    >,
    recommendationsCount: Number.isInteger(count) && count >= 1 && count <= 7 ? count : d.recommendationsCount,
    aiInstructions: str(r.aiInstructions, AI_DIGEST_INSTRUCTIONS_MAX * 2, d.aiInstructions),
    shortTemplate: str(r.shortTemplate, AI_DIGEST_SHORT_MAX * 2, d.shortTemplate),
  };
}

export type AiDigestValidation = { ok: true; config: AiDigestConfig } | { ok: false; error: string };

/** Проверка перед сохранением: текст ошибки видит ROOT. */
export function validateAiDigestConfig(raw: unknown): AiDigestValidation {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const s = r.schedule && typeof r.schedule === "object" ? (r.schedule as Record<string, unknown>) : {};
  if (typeof s.time === "string" && !isValidTime(s.time)) {
    return { ok: false, error: "Время отправки — в виде ЧЧ:ММ, например 23:59" };
  }
  const config = normalizeAiDigestConfig(raw);
  config.emailSubject = config.emailSubject.replace(/\s+/g, " ").trim();
  config.emailIntro = config.emailIntro.trim();
  config.aiInstructions = config.aiInstructions.trim();
  config.shortTemplate = config.shortTemplate.trim();
  if (!config.emailSubject) return { ok: false, error: "Напишите тему письма" };
  if (config.emailSubject.length > AI_DIGEST_SUBJECT_MAX) {
    return { ok: false, error: `Тема письма — не длиннее ${AI_DIGEST_SUBJECT_MAX} знаков` };
  }
  if (config.emailIntro.length > AI_DIGEST_INTRO_MAX) {
    return { ok: false, error: `Вступление — не длиннее ${AI_DIGEST_INTRO_MAX} знаков` };
  }
  if (config.aiInstructions.length > AI_DIGEST_INSTRUCTIONS_MAX) {
    return { ok: false, error: `Указания для ИИ — не длиннее ${AI_DIGEST_INSTRUCTIONS_MAX} знаков` };
  }
  if ((config.channels.telegram || config.channels.max) && !config.shortTemplate) {
    return { ok: false, error: "Напишите короткий текст для Telegram и MAX или выключите эти каналы" };
  }
  if (config.shortTemplate.length > AI_DIGEST_SHORT_MAX) {
    return { ok: false, error: `Короткий текст — не длиннее ${AI_DIGEST_SHORT_MAX} знаков` };
  }
  if (!AI_DIGEST_CHANNELS.some((c) => config.channels[c])) {
    return { ok: false, error: "Выберите хотя бы один канал: почта, Telegram или MAX" };
  }
  const unknown = unknownVariables([config.emailSubject, config.emailIntro, config.shortTemplate].join("\n"));
  if (unknown.length > 0) {
    return { ok: false, error: `Неизвестные переменные: ${unknown.map((v) => `{${v}}`).join(", ")}` };
  }
  return { ok: true, config };
}

const VARIABLE_RE = /\{([a-zA-Z]+)\}/g;
const KNOWN = new Set(AI_DIGEST_VARIABLES.map((v) => v.key));

export function unknownVariables(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(VARIABLE_RE)) {
    if (!KNOWN.has(match[1])) out.add(match[1]);
  }
  return [...out];
}

/** Подстановка `{переменных}`; неизвестные остаются как есть. */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE_RE, (whole, key: string) => (key in values ? values[key] : whole));
}
