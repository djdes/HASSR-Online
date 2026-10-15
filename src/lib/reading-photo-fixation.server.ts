import { db } from "@/lib/db";
import { sensorCameraEnabled, type SensorJournalCode } from "@/lib/journal-controls";
import { getJournalControls } from "@/lib/journal-controls.server";
import {
  applyReadingPhotoPatch,
  isDefaultReadingPhotoSettings,
  parseReadingPhotoSettings,
  readingPhotoSettingKey,
  serializeReadingPhotoSettings,
  type ReadingPhotoPatch,
  type ReadingPhotoSettings,
} from "@/lib/reading-photo-fixation";

/**
 * Настройка «Фотофиксация показаний» организации — чтение и запись строки
 * `PlatformSetting` (`org-reading-photo:<id>`). Почему не колонка и не
 * JSON организации — см. `reading-photo-fixation.ts`. Ключ строится только
 * из id организации, который сервер взял из подписи наклейки или сессии, —
 * данные одной организации другой не видны.
 */

export async function getReadingPhotoSettings(organizationId: string, journalCode?: SensorJournalCode): Promise<ReadingPhotoSettings> {
  const row = await db.platformSetting.findUnique({
    where: { key: readingPhotoSettingKey(organizationId) },
    select: { value: true },
  });
  const settings = parseReadingPhotoSettings(row?.value ?? null);
  if (!journalCode) return settings;
  const enabled = sensorCameraEnabled(await getJournalControls(organizationId), journalCode);
  return { enabled, required: enabled && settings.required };
}

/** Применить изменение руководителя; вернули умолчания — строку удаляем. */
export async function updateReadingPhotoSettings(
  organizationId: string,
  patch: ReadingPhotoPatch
): Promise<ReadingPhotoSettings> {
  const key = readingPhotoSettingKey(organizationId);
  const current = await getReadingPhotoSettings(organizationId);
  const next = applyReadingPhotoPatch(current, patch);
  if (isDefaultReadingPhotoSettings(next)) {
    await db.platformSetting.deleteMany({ where: { key } });
  } else {
    const value = serializeReadingPhotoSettings(next);
    await db.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  return next;
}
