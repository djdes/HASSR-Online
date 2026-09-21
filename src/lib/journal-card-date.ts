/**
 * Дата в подписи карточки записи — один формат на все журналы.
 *
 * Тестировщик за один заход увидел в карточках три разных написания
 * одной и той же вещи: «2026-09-15 09:00» в журнале скоропорта,
 * «18-09-2026 09:30» во входном контроле и жалобах, «01.09.2026» во
 * фритюре. Для человека это три разных поля, хотя это одна дата.
 *
 * Печатные бланки и значения в самих полях ввода трогать нельзя: там
 * формат диктует форма документа. Этот помощник — ТОЛЬКО для подписей
 * и заголовков карточек.
 *
 * `formatJournalDate` — то же самое для списков документов, где времени
 * нет: там за один заход встречались «2026-09-18» (протокол и отчёт об
 * аудите), «01-09-2026» (большинство журналов) и «01.09.2026»
 * (дезинсекция, акт забраковки).
 */

/** Принимает `YYYY-MM-DD`, `DD-MM-YYYY` или `DD.MM.YYYY`. */
function parseDayParts(value: string): [string, string, string] | null {
  const raw = value.trim();
  if (!raw) return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) return [match[3], match[2], match[1]];
  match = /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/.exec(raw);
  if (match) {
    return [match[1].padStart(2, "0"), match[2].padStart(2, "0"), match[3]];
  }
  return null;
}

/** `09:5` → `09:05`; мусор → пустая строка. */
function normalizeTime(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`;
}

/**
 * «дд.мм.гггг чч:мм» — или «дд.мм.гггг», если времени нет.
 * Дата не разобралась — возвращаем исходную строку: молча терять
 * содержимое карточки нельзя.
 */
export function formatJournalDate(
  date: string | Date | null | undefined
): string {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return "";
    return formatCardDateTime(date.toISOString().slice(0, 10));
  }
  return formatCardDateTime(date);
}

export function formatCardDateTime(
  date: string | null | undefined,
  time?: string | null
): string {
  const raw = String(date ?? "").trim();
  const parts = parseDayParts(raw);
  const clock = normalizeTime(time);
  if (!parts) return [raw, clock].filter(Boolean).join(" ");
  const [day, month, year] = parts;
  return [`${day}.${month}.${year}`, clock].filter(Boolean).join(" ");
}
