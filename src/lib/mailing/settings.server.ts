import { db } from "@/lib/db";

import {
  DEFAULT_MAILING_SETTINGS,
  MAILING_SETTINGS_KEY,
  minuteWindowStart,
  mskDayStart,
  normalizeMailingSettings,
  type MailingSettings,
} from "./rate-limit";

/** Настройка скорости из `PlatformSetting`; сбой чтения — значения по умолчанию. */
export async function readMailingSettings(): Promise<MailingSettings> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: MAILING_SETTINGS_KEY } });
    if (!row) return DEFAULT_MAILING_SETTINGS;
    return normalizeMailingSettings(JSON.parse(row.value));
  } catch (error) {
    console.error("[mailing] settings read failed — using defaults", error);
    return DEFAULT_MAILING_SETTINGS;
  }
}

export async function writeMailingSettings(next: MailingSettings): Promise<MailingSettings> {
  const value = JSON.stringify(normalizeMailingSettings(next));
  await db.platformSetting.upsert({
    where: { key: MAILING_SETTINGS_KEY },
    create: { key: MAILING_SETTINGS_KEY, value },
    update: { value },
  });
  return normalizeMailingSettings(JSON.parse(value));
}

/** Сколько писем рассылок ушло сегодня (с 00:00 МСК) и за последнюю минуту; тесты себе не в счёт. */
export async function emailSendStats(now: Date = new Date()): Promise<{ today: number; lastMinute: number }> {
  const [today, lastMinute] = await Promise.all([
    db.mailingRecipient.count({ where: { emailSentAt: { gte: mskDayStart(now) }, isTest: false } }),
    db.mailingRecipient.count({ where: { emailSentAt: { gte: minuteWindowStart(now) }, isTest: false } }),
  ]);
  return { today, lastMinute };
}
