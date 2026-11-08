/**
 * CRM платформы (/root/crm): справочники и сроки. Чистый модуль — его читают
 * и сервер, и клиентские экраны.
 */

export const CRM_STAGES = ["new", "in_work", "won", "lost", "spam"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  new: "Новый",
  in_work: "В работе",
  won: "Клиент",
  lost: "Отказ",
  spam: "Спам",
};

/** По отказам и спаму CRM молчит: никаких напоминаний. */
export const QUIET_STAGES: ReadonlySet<string> = new Set(["lost", "spam"]);

export function isCrmStage(value: unknown): value is CrmStage {
  return typeof value === "string" && (CRM_STAGES as readonly string[]).includes(value);
}

export const CRM_CHANNEL_LABELS: Record<string, string> = {
  email: "Почта",
  chat: "Онлайн-чат",
  feedback: "Обращение с сайта",
  telegram: "Telegram",
  demo: "Показ за 15 минут",
  service: "Заявка на услугу",
  invoice: "Счёт по ИНН",
  signup: "Регистрация",
  blank: "Скачал шаблон",
  partner: "Заявка партнёра",
  whatsapp: "WhatsApp",
  vk: "ВКонтакте",
  max: "MAX",
  phone: "Телефон",
  call: "Звонок",
  note: "Заметка",
  resolved: "Ответ не нужен",
  other: "Другое",
};

export function crmChannelLabel(channel: string): string {
  return CRM_CHANNEL_LABELS[channel] ?? channel;
}

/** Откуда можно завести лид руками: мессенджеры, которых нет в API. */
export const MANUAL_LEAD_CHANNELS = ["whatsapp", "telegram", "max", "vk", "phone", "email", "other"] as const;
export type ManualLeadChannel = (typeof MANUAL_LEAD_CHANNELS)[number];

export const CRM_DIRECTIONS = ["in", "out", "note", "event"] as const;
export type CrmDirection = (typeof CRM_DIRECTIONS)[number];

export const CRM_FILTER_REASONS = {
  blocked: "Стоп-лист",
  no_sender: "Нет отправителя",
  internal: "Внутренняя переписка",
  bounce: "Недоставка",
  auto_reply: "Автоответ",
  spam: "Спам",
  newsletter: "Рассылка",
  robot: "Робот / уведомление",
} as const;
export type CrmFilterReason = keyof typeof CRM_FILTER_REASONS;

export function crmFilterReasonLabel(reason: string): string {
  return (CRM_FILTER_REASONS as Record<string, string>)[reason] ?? reason;
}

/** Наши домены: письма с них — внутренние (уведомления сайта, коллеги). */
export const OUR_MAIL_DOMAINS = ["wesetup.ru"] as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Первое напоминание «нет ответа клиенту» — ответственному. */
export const CRM_FIRST_REMINDER_MS = 30 * MINUTE;
/** Эскалация РОП: столько без ответа. */
export const CRM_ESCALATION_MS = 4 * HOUR;
/** Дальше не пингуем — это уже разбор очереди, а не быстрый ответ. */
export const CRM_GIVE_UP_MS = 7 * DAY;
/** Клиент молчит после нашего ответа — пора напомнить о себе. */
export const CRM_SILENT_AFTER_MS = 3 * DAY;
export const CRM_SILENT_GIVE_UP_MS = 14 * DAY;
/** Просроченный следующий шаг напоминаем не дольше недели. */
export const CRM_NEXT_ACTION_GIVE_UP_MS = 7 * DAY;

/** Рабочие часы напоминаний по Москве (UTC+3 круглый год): [9, 21). */
export const CRM_WORK_HOURS = { start: 9, end: 21 } as const;
export const CRM_DIGEST_HOUR = 9;
export const MOSCOW_OFFSET_MS = 3 * HOUR;

/** Первый сбор: история внутренних источников и окно почты. */
export const CRM_SOURCES_BACKFILL_MS = 90 * DAY;
export const CRM_MAIL_BACKFILL_MS = 30 * DAY;
/** Нахлёст курсора: строки, записанные «задним числом» в ту же минуту. */
export const CRM_CURSOR_OVERLAP_MS = 10 * MINUTE;
export const CRM_MAIL_BATCH = 200;
export const CRM_MAIL_MAX_BYTES = 256 * 1024;
export const CRM_BODY_MAX = 4000;
