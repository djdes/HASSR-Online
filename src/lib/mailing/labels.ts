/**
 * Каналы, статусы и их русские подписи — общие для сервера, форм ROOT и
 * тестов. Без импорта базы.
 */

export const MAILING_CHANNELS = ["email", "inApp", "push", "telegram"] as const;
export type MailingChannel = (typeof MAILING_CHANNELS)[number];
export type MailingChannels = Record<MailingChannel, boolean>;

export const CHANNEL_LABELS: Record<MailingChannel, string> = {
  email: "Почта",
  inApp: "Колокольчик",
  push: "Push",
  telegram: "Telegram",
};

export const NO_CHANNELS: MailingChannels = { email: false, inApp: false, push: false, telegram: false };

export function normalizeChannels(raw: unknown): MailingChannels {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    email: r.email === true,
    inApp: r.inApp === true,
    push: r.push === true,
    telegram: r.telegram === true,
  };
}

export function anyChannel(channels: MailingChannels): boolean {
  return MAILING_CHANNELS.some((c) => channels[c]);
}

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "done", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Черновик",
  scheduled: "Запланирована",
  sending: "Отправляется",
  done: "Завершена",
  cancelled: "Отменена",
};

/** Статус канала у получателя; null — канал не для него. */
export type ChannelStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  queued: "В очереди",
  sending: "Отправляется",
  sent: "Отправлено",
  failed: "Ошибка",
  skipped: "Пропущено",
};

export type RecipientStatus = "queued" | "sent" | "failed" | "skipped" | "cancelled";

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  queued: "В очереди",
  sent: "Отправлено",
  failed: "Ошибка",
  skipped: "Пропущено",
  cancelled: "Отменено",
};

/**
 * Итог получателя по каналам: ещё что-то в очереди — «в очереди»; иначе
 * хоть что-то ушло — «отправлено»; иначе ошибка — «ошибка»; иначе
 * «пропущено».
 */
export function overallRecipientStatus(channels: Array<ChannelStatus | null | undefined>): RecipientStatus {
  const used = channels.filter((c): c is ChannelStatus => Boolean(c));
  if (used.some((c) => c === "queued" || c === "sending")) return "queued";
  if (used.some((c) => c === "sent")) return "sent";
  if (used.some((c) => c === "failed")) return "failed";
  return "skipped";
}

export const CONTACT_STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  unsubscribed: "Отписался",
  bounced: "Адрес не принимает",
  complained: "Пожаловался",
};

export const SUPPRESSION_REASON_LABELS: Record<string, string> = {
  unsubscribed: "Отписался",
  bounced: "Адрес не принимает почту",
  complained: "Пожаловался на спам",
  manual: "Добавлен вручную",
};

export const BILLING_KIND_LABELS: Record<string, string> = {
  paid: "Подписка",
  free: "Бесплатный",
  free_period: "Бесплатный период",
  needs_decision: "Ждёт решения",
  legacy: "Как раньше (тестовый режим)",
  exempt: "Без тарифа",
};
