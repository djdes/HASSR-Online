/**
 * Помощники блоков санитарии (дезинсекция и дератизация, лаборатория): следующая
 * дата исследования и подсветка сроков. Чистые функции без БД и React.
 * Даты — строки YYYY-MM-DD; считаем в UTC, чтобы часовой пояс не сдвигал день.
 */
import type { LabPlanItem } from "./records";

/** Состояние срока: просрочено, скоро (в ближайшие 14 дней), в норме, даты нет. */
export type DueState = "overdue" | "soon" | "ok" | "none";

/** Окно «скоро» в днях, включая сегодня. */
const SOON_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return formatDate(new Date(parseDate(value).getTime() + days * DAY_MS));
}

/** Прибавить месяцы; если в целевом месяце нет такого числа, берём последний день месяца. */
function addMonths(value: string, months: number): string {
  const base = parseDate(value);
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return formatDate(target);
}

/** Следующая дата исследования: последняя плюс периодичность. Без последней даты — null. */
export function labNextDate(item: Pick<LabPlanItem, "lastDate" | "everyMonths">): string | null {
  if (!item.lastDate) return null;
  return addMonths(item.lastDate, item.everyMonths);
}

/**
 * Следующая обработка по периодичности из подсказок («Еженедельно» … «Раз в год»).
 * Регистр и пробелы не важны; «По заявке» и незнакомый текст — null.
 */
export function pestNextDate(frequency: string, fromYmd: string): string | null {
  const key = frequency.trim().toLowerCase().replace(/\s+/g, " ");
  if (key === "еженедельно") return addDays(fromYmd, 7);
  if (key === "ежемесячно") return addMonths(fromYmd, 1);
  if (key === "ежеквартально") return addMonths(fromYmd, 3);
  if (key === "раз в полгода") return addMonths(fromYmd, 6);
  if (key === "раз в год" || key === "ежегодно") return addMonths(fromYmd, 12);
  return null;
}

/** Срок относительно сегодняшней даты: дата раньше сегодня — просрочено. */
export function dueState(nextDate: string | null, today: string): DueState {
  if (!nextDate) return "none";
  if (nextDate < today) return "overdue";
  if (nextDate <= addDays(today, SOON_DAYS)) return "soon";
  return "ok";
}

/** Сегодняшняя дата по локальному часовому поясу браузера или сервера, YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
