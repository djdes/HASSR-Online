/**
 * «Дата записи вне периода документа» — предупреждение, а не запрет.
 *
 * ПОЧЕМУ: в журналах со свободной датой записи (жалобы, аварии, поломки…)
 * запись за 21.09.2026 молча уезжала в документ на 2027 год и печаталась
 * в бланке 2027. Запрещать нельзя — бывает, что запись вносят задним
 * числом в тот бланк, который есть. Но человек должен это увидеть и
 * подтвердить.
 *
 * Чистая функция: даты — строки `YYYY-MM-DD`, без `new Date()`.
 */
import { isPerpetualDateTo } from "@/lib/journal-period";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function toRu(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Текст предупреждения, если `dateKey` лежит вне [`dateFrom`, `dateTo`].
 * Нет даты / нет периода / дата внутри — `null`. У бессрочного документа
 * (`dateTo` = 31.12.2099) верхней границы нет.
 */
export function describeDateOutsidePeriod(
  dateKey: string | null | undefined,
  period: { dateFrom?: string | null; dateTo?: string | null }
): string | null {
  const day = String(dateKey ?? "").slice(0, 10);
  const from = String(period.dateFrom ?? "").slice(0, 10);
  const rawTo = String(period.dateTo ?? "").slice(0, 10);
  if (!ISO_DAY.test(day) || !ISO_DAY.test(from)) return null;
  const to = ISO_DAY.test(rawTo) && !isPerpetualDateTo(rawTo) ? rawTo : null;

  // Строки YYYY-MM-DD сравниваются лексикографически так же, как даты.
  const before = day < from;
  const after = to !== null && day > to;
  if (!before && !after) return null;

  const range = to ? `${toRu(from)}–${toRu(to)}` : `с ${toRu(from)}`;
  return `Дата ${toRu(day)} вне периода документа (${range}). Всё равно сохранить?`;
}
