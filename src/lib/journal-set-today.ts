/**
 * Статус журнала набора на сегодня — страницы «Журналы → Наборы журналов»
 * (`/journals/sets/*`).
 *
 * «Заполнен сегодня» приходит из того же расчёта, что «Сегодня»
 * (`getTemplatesFilledToday` с `treatAperiodicAsFilled: false`). Журнал без
 * ежедневной обязанности (не из `ALL_DAILY_JOURNAL_CODES`: приёмка, поломки,
 * жалобы) без записи за сегодня — «не требуется сегодня», а не «не заполнен».
 *
 * Модуль чистый (без БД): его читают страница и тесты.
 */
import { ALL_DAILY_JOURNAL_CODES } from "@/lib/daily-journal-codes";

export type JournalSetTodayStatus = "filled" | "notFilled" | "notRequired" | "off";

export function journalSetTodayStatus(code: string, enabled: boolean, filledToday: boolean): JournalSetTodayStatus {
  if (!enabled) return "off";
  if (filledToday) return "filled";
  return ALL_DAILY_JOURNAL_CODES.has(code) ? "notFilled" : "notRequired";
}

export type JournalSetSummary = {
  /** Пунктов в наборе. */
  total: number;
  /** Включено из них. */
  enabled: number;
  /** Включённых, которые сегодня ждут записи (или уже получили её). */
  required: number;
  /** Заполнено сегодня. */
  filled: number;
  /** Выключенные пункты — то, что включит «Включить весь набор». */
  disabledCodes: string[];
};

export function summarizeJournalSet(
  items: readonly { code: string; enabled: boolean; today: JournalSetTodayStatus }[],
): JournalSetSummary {
  return {
    total: items.length,
    enabled: items.filter((item) => item.enabled).length,
    required: items.filter((item) => item.today === "filled" || item.today === "notFilled").length,
    filled: items.filter((item) => item.today === "filled").length,
    disabledCodes: items.filter((item) => !item.enabled).map((item) => item.code),
  };
}
