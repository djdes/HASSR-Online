/**
 * Фотофиксация показаний (2026-09-27). Диалог владельца с клиентом:
 * заведующая сканирует QR холодильной камеры, вводит PIN — а там кнопка
 * «Сфотографируйте показание»: сфотала — показание само считалось и ввелось,
 * фото легло в журнал. «Не захотела фотать — ввела по старинке, или
 * организации это не надо — сняли галочку, и кнопка пропала».
 *
 * Настройка организации («Настройки → Строгость журналов → Запись по
 * QR-плакату»):
 *   • `enabled` — фотофиксация включена (по умолчанию да): в QR-формах
 *     холодильника и склада первым идёт «Сфотографируйте показание»;
 *     выключена — ни большой кнопки, ни «Фото» у поля, сервер фото не берёт;
 *   • `required` — «Фото обязательно»: температуру без снимка не сохранить
 *     («Обслуживание/Ремонт» и влажность — без фото). Без `enabled` не бывает.
 *
 * Хранение без изменения схемы: общего JSON-поля настроек у организации нет,
 * а у каждого JSON-поля (`customNamesJson`, `journalTaskModesJson`, …) свой
 * разборщик, который выбрасывает чужие ключи, — флаг там молча пропал бы при
 * сохранении соседней настройки. Поэтому строка таблицы ключ-значение
 * `PlatformSetting` с ключом `org-reading-photo:<id организации>` и JSON
 * `{"enabled":…,"required":…}` (см. `reading-photo-fixation.server.ts`).
 * Нет строки — значения по умолчанию; вернули умолчания — строка удаляется.
 *
 * Модуль без Node-зависимостей: его читают сервер и QR-формы.
 */

export type ReadingPhotoSettings = { enabled: boolean; required: boolean };

export const DEFAULT_READING_PHOTO_SETTINGS: ReadingPhotoSettings = Object.freeze({ enabled: true, required: false });

const SETTING_KEY_PREFIX = "org-reading-photo:";

/** Ключ строки `PlatformSetting` организации. */
export function readingPhotoSettingKey(organizationId: string): string {
  if (!organizationId) throw new Error("reading-photo: organizationId required");
  return `${SETTING_KEY_PREFIX}${organizationId}`;
}

/**
 * Значение строки (JSON-текст или объект) → настройки. Мусор и пусто —
 * умолчания; «обязательно» без «включено» не бывает.
 */
export function parseReadingPhotoSettings(raw: unknown): ReadingPhotoSettings {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return { ...DEFAULT_READING_PHOTO_SETTINGS };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_READING_PHOTO_SETTINGS };
  const entry = value as Record<string, unknown>;
  const enabled = typeof entry.enabled === "boolean" ? entry.enabled : DEFAULT_READING_PHOTO_SETTINGS.enabled;
  const required = enabled && entry.required === true;
  return { enabled, required };
}

export type ReadingPhotoPatch = { enabled?: boolean; required?: boolean };

/**
 * Изменение от руководителя. Выключил фотофиксацию — «обязательно» снимается
 * тоже; включил «обязательно» — фотофиксация включается.
 */
export function applyReadingPhotoPatch(current: ReadingPhotoSettings, patch: ReadingPhotoPatch): ReadingPhotoSettings {
  let enabled = typeof patch.enabled === "boolean" ? patch.enabled : current.enabled;
  let required = typeof patch.required === "boolean" ? patch.required : current.required;
  if (patch.required === true) enabled = true;
  if (!enabled) required = false;
  return { enabled, required };
}

export function isDefaultReadingPhotoSettings(settings: ReadingPhotoSettings): boolean {
  return settings.enabled === DEFAULT_READING_PHOTO_SETTINGS.enabled && settings.required === DEFAULT_READING_PHOTO_SETTINGS.required;
}

export function serializeReadingPhotoSettings(settings: ReadingPhotoSettings): string {
  return JSON.stringify({ enabled: settings.enabled, required: settings.enabled && settings.required });
}

/** Тексты — одни на QR-форме, в ответах сервера и в настройках. */
export const READING_PHOTO_FIXATION_TEXT = {
  primaryButton: "Сфотографируйте показание",
  manualButton: "Ввести вручную",
  confirmSave: "Всё верно — сохранить",
  needPhoto: "Нужно фото показания",
  disabledError: "Фотофиксация показаний выключена в настройках — введите показание вручную",
  requiredError: "Нужно фото показания — сфотографируйте термометр или дисплей",
} as const;

export const READING_PHOTO_DISABLED_CODE = "photo_disabled";
export const READING_PHOTO_REQUIRED_CODE = "photo-required";

/**
 * Что делать с фото при сохранении замера (сервер, оба QR-маршрута).
 * `photo` — уже проверенная ссылка на снимок из каталога или null;
 * `hasReading` — сохраняется температура (не «обсл»/«рем» и не одна влажность).
 *
 *   • фотофиксация выключена — присланное фото не прикладываем (форма,
 *     открытая до выключения, не ломается: замер сохраняется без снимка);
 *   • «Фото обязательно» и температура без фото — отказ 400;
 *   • иначе фото — к температуре, как раньше.
 */
export function resolveReadingPhotoForSave(input: {
  settings: ReadingPhotoSettings;
  hasReading: boolean;
  photo: string | null;
}):
  | { ok: true; photo: string | null; ignored: boolean }
  | { ok: false; status: 400; code: typeof READING_PHOTO_REQUIRED_CODE; error: string } {
  const { settings, hasReading } = input;
  const photo = hasReading && input.photo ? input.photo : null;
  if (!settings.enabled) return { ok: true, photo: null, ignored: Boolean(photo) };
  if (settings.required && hasReading && !photo) {
    return { ok: false, status: 400, code: READING_PHOTO_REQUIRED_CODE, error: READING_PHOTO_FIXATION_TEXT.requiredError };
  }
  return { ok: true, photo, ignored: false };
}

/* ─────────── QR-форма: что показывать ─────────── */

/** Как человек вводит показание: снимком (по умолчанию при фотофиксации) или руками. */
export type ReadingEntry = "photo" | "manual";

/** Этап снимка: нет снимка / загружаем или распознаём / снимок обработан. */
export type ReadingPhotoPhase = "idle" | "busy" | "done";

/** Черновик «−» морозилки или пустое поле — это ещё не введённое число. */
export function isBlankReading(value: string): boolean {
  const text = value.trim();
  return text === "" || text === "-";
}

/** С чего начинается форма: снимком, если фотофиксация включена и значения ещё нет. */
export function initialReadingEntry(settings: ReadingPhotoSettings, value: string): ReadingEntry {
  return settings.enabled && isBlankReading(value) ? "photo" : "manual";
}

/**
 * Раскладка формы замера.
 *
 *   • `photoFirst` — главная кнопка «Сфотографируйте показание» и
 *     «Ввести вручную»; поля и «Сохранить» ещё нет;
 *   • пока снимок грузится и распознаётся (а числа нет) — только карточка
 *     фото: поле появится уже с числом (или пустым, если не разобрали);
 *   • потом — поле, фото под ним и «Сохранить», как при ручном вводе.
 *
 * «Обслуживание/Ремонт» (`status`) заменяет замер: поля нет, «Сохранить» есть.
 */
export function readingFormView(input: {
  settings: ReadingPhotoSettings;
  entry: ReadingEntry;
  phase: ReadingPhotoPhase;
  photoUrl: string | null;
  value: string;
  status: boolean;
}): { photoFirst: boolean; showField: boolean; showSave: boolean } {
  const { settings, entry, phase, photoUrl, value, status } = input;
  const photoEntry = settings.enabled && entry === "photo" && isBlankReading(value);
  const photoFirst = photoEntry && !status && !photoUrl && phase === "idle";
  const waiting = photoEntry && !status && phase === "busy";
  const showField = !status && !photoFirst && !waiting;
  return { photoFirst, showField, showSave: status || showField };
}

/** «Фото обязательно», а снимка к температуре нет — «Сохранить» неактивна. */
export function isReadingPhotoMissing(input: {
  settings: ReadingPhotoSettings;
  hasReading: boolean;
  photoUrl: string | null;
}): boolean {
  return input.settings.enabled && input.settings.required && input.hasReading && !input.photoUrl;
}
