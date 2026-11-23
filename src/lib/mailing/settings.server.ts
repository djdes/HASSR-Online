import { db } from "@/lib/db";

import {
  DEFAULT_MAILING_SETTINGS,
  MAILING_SETTINGS_KEY,
  minuteWindowStart,
  mskDayStart,
  mskHourStart,
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

/** Последний проход очереди — для «Состояния очереди»: старше 5 минут — cron не работает. */
export const MAILING_WORKER_KEY = "mailing.worker";

export type WorkerHeartbeat = {
  lastRunAt: string;
  source: string;
  processed: number;
  disabled: boolean;
};

export async function writeWorkerHeartbeat(beat: WorkerHeartbeat): Promise<void> {
  const value = JSON.stringify(beat);
  try {
    await db.platformSetting.upsert({
      where: { key: MAILING_WORKER_KEY },
      create: { key: MAILING_WORKER_KEY, value },
      update: { value },
    });
  } catch (error) {
    // Отметка — для экрана; её сбой не должен ронять проход очереди.
    console.error("[mailing] worker heartbeat write failed", error);
  }
}

export async function readWorkerHeartbeat(): Promise<WorkerHeartbeat | null> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: MAILING_WORKER_KEY } });
    if (!row) return null;
    const raw = JSON.parse(row.value) as Partial<WorkerHeartbeat>;
    if (typeof raw.lastRunAt !== "string") return null;
    return {
      lastRunAt: raw.lastRunAt,
      source: typeof raw.source === "string" ? raw.source : "",
      processed: typeof raw.processed === "number" ? raw.processed : 0,
      disabled: raw.disabled === true,
    };
  } catch (error) {
    console.error("[mailing] worker heartbeat read failed", error);
    return null;
  }
}

/** Писем рассылок за текущий час по Москве (тесты себе не в счёт). */
export async function emailsSentThisHour(now: Date = new Date()): Promise<number> {
  return db.mailingRecipient.count({ where: { emailSentAt: { gte: mskHourStart(now) }, isTest: false } });
}
