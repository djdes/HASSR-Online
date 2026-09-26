/**
 * Фото к замеру температуры (2026-09-26). Правка владельца: «Фото на
 * температуру дать возможность, автовведение температуры с фото в платном
 * тарифе».
 *
 * В QR-форме холодильника и склада у поля температуры кнопка «Фото»:
 * снимок ложится в каталог загрузок (`/uploads/readings/<32 hex>.jpg`), а
 * ссылка на него — в JSON записи журнала рядом со значением (схема БД не
 * меняется):
 *
 *   • cold_equipment_control — `readingPhotos[<ключ замера>]`, тот же ключ,
 *     что в `temperatures` (`<id строки>` / `<id строки>#2`);
 *   • climate_control — `readingPhotos[<строка>:<срок>:temperature]`, тот же
 *     ключ, что у комментария к отклонению (`climateCorrectionKey`).
 *
 * Новое фото замера заменяет прежнее; запись без фото прежнее не стирает —
 * доказательство не пропадает от повторного сохранения. «Как вчера» и
 * автозаполнение фото не переносят: снимок — событие своего дня.
 *
 * На платном тарифе показание со снимка распознаётся (вид `reading`
 * диспетчера) и подставляется в поле с пометкой «с фото — проверьте»; на
 * бесплатном фото прикрепляется, а вместо автоввода — подсказка о тарифе.
 *
 * Модуль без Node-зависимостей: его читают и сервер, и клиент (миниатюры
 * в документе журнала).
 */

/** Подкаталог каталога загрузок (`uploadsDir()`), куда кладутся снимки замеров. */
export const READING_PHOTO_SUBDIR = "readings";

const READING_PHOTO_URL_RE = /^\/uploads\/readings\/[a-f0-9]{32}\.(?:jpg|png|webp)$/;

/** Ключ в данных записи журнала: `readingPhotos[<ключ замера>] = <ссылка>`. */
export const READING_PHOTOS_KEY = "readingPhotos";

/** Длиннее ключ замера не бывает (id строки + «#3» или «:ЧЧ:ММ:temperature»). */
const MAX_PHOTO_KEY_LENGTH = 200;

/** Адрес страницы тарифов — руководителю в подсказке «на платном тарифе». */
export const TARIFFS_HREF = "/settings/subscription";

/** Тексты — одни на QR-форме и в документе журнала. */
export const READING_PHOTO_TEXT = {
  button: "Фото",
  paidOnly: "Автоввод с фото — на платном тарифе",
  tariffsLink: "Тарифы",
  unreadable: "Не разобрали цифры — введите вручную",
  checkMark: "с фото — проверьте",
  recognizing: "Распознаём показание… обычно 10–40 секунд",
  uploading: "Загружаем фото…",
  attached: "Фото прикреплено к замеру",
} as const;

/** Ссылка на снимок замера: только наш каталог и случайное имя — никаких чужих адресов в журнале. */
export function isReadingPhotoUrl(value: unknown): value is string {
  return typeof value === "string" && READING_PHOTO_URL_RE.test(value);
}

/** Имя файла по расширению снимка. */
export function readingPhotoFileName(id: string, ext: "jpg" | "png" | "webp"): string {
  return `${id}.${ext}`;
}

/** `/uploads/readings/<имя>` → сегменты пути внутри каталога загрузок; чужое — null. */
export function readingPhotoPathSegments(url: string): [string, string] | null {
  if (!isReadingPhotoUrl(url)) return null;
  return [READING_PHOTO_SUBDIR, url.slice(`/uploads/${READING_PHOTO_SUBDIR}/`.length)];
}

/**
 * Карта «ключ замера → фото» из сырых данных записи. Всё, что не похоже на
 * нашу ссылку (в том числе `javascript:` и внешние адреса, прописанные в
 * данные руками через API), отбрасывается — в журнал попадает только файл
 * из каталога снимков. Пустая карта — undefined (ключ в записи не нужен).
 */
export function normalizeReadingPhotos(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const photos: Record<string, string> = {};
  for (const [key, url] of Object.entries(value as Record<string, unknown>)) {
    if (!key || key.length > MAX_PHOTO_KEY_LENGTH) continue;
    if (isReadingPhotoUrl(url)) photos[key] = url;
  }
  return Object.keys(photos).length > 0 ? photos : undefined;
}

/**
 * Поставить фото замеру (новая карта). `null` — ничего не меняет: запись
 * без нового снимка прежний не стирает.
 */
export function withReadingPhoto(
  photos: Record<string, string> | undefined,
  key: string,
  url: string | null | undefined
): Record<string, string> | undefined {
  if (!url || !isReadingPhotoUrl(url) || !key) return photos;
  return { ...(photos ?? {}), [key]: url };
}

/** Какой показатель снимают: у кнопки «Фото» он известен заранее. */
export type ReadingMetric = "temperature" | "humidity";

export function isReadingMetric(value: unknown): value is ReadingMetric {
  return value === "temperature" || value === "humidity";
}

/**
 * Пределы, за которыми число с дисплея — не показание, а ошибка чтения
 * (например, «450» вместо «4.5»). Такое в поле не подставляем.
 */
export const READING_METRIC_RANGE: Record<ReadingMetric, { min: number; max: number }> = {
  temperature: { min: -60, max: 80 },
  humidity: { min: 0, max: 100 },
};

const METRIC_UNIT: Record<ReadingMetric, "C" | "%"> = { temperature: "C", humidity: "%" };

/**
 * Можно ли подставить распознанное число в поле показателя. Не та единица
 * (влажность «%» в поле температуры, часы наработки) или невозможное
 * значение — null: лучше пустое поле с просьбой ввести вручную, чем чужое
 * число в журнале.
 */
export function acceptRecognizedReading(
  result: { value: number | null; unit: string | null } | null | undefined,
  metric: ReadingMetric
): number | null {
  if (!result || typeof result.value !== "number" || !Number.isFinite(result.value)) return null;
  if (result.unit !== null && result.unit !== METRIC_UNIT[metric]) return null;
  const range = READING_METRIC_RANGE[metric];
  if (result.value < range.min || result.value > range.max) return null;
  return result.value;
}

/** Число для поля ввода: без «-0» и хвостов вроде 4.500000001. */
export function formatRecognizedReading(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
