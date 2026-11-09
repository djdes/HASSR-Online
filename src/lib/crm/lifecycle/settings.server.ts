import { db } from "@/lib/db";

import { LIFECYCLE_SETTING_KEY, normalizeLifecycleSettings, type LifecycleSettings } from "./settings";

/** Настройки автоворонки (`PlatformSetting` `crm:lifecycle`); нет записи — по умолчанию. */
export async function readLifecycleSettings(): Promise<LifecycleSettings> {
  const row = await db.platformSetting.findUnique({ where: { key: LIFECYCLE_SETTING_KEY } }).catch(() => null);
  if (!row) return normalizeLifecycleSettings(null);
  try {
    return normalizeLifecycleSettings(JSON.parse(row.value));
  } catch {
    return normalizeLifecycleSettings(null);
  }
}

export async function writeLifecycleSettings(settings: LifecycleSettings): Promise<LifecycleSettings> {
  const value = JSON.stringify(settings);
  await db.platformSetting.upsert({ where: { key: LIFECYCLE_SETTING_KEY }, create: { key: LIFECYCLE_SETTING_KEY, value }, update: { value } });
  return settings;
}

/**
 * Письма «пробный заканчивается» и «оплата заканчивается» шлёт автоворонка —
 * ежедневная задача биллинга свои в это время не шлёт (иначе два письма).
 */
export async function lifecycleOwnsBillingReminders(): Promise<boolean> {
  const settings = await readLifecycleSettings();
  return settings.enabled && settings.clientMessages;
}
