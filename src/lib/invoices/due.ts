import { INVOICE_VALID_DAYS } from "./build";

/**
 * Срок оплаты счёта по безналу — чистая функция (её зовёт `service.ts`,
 * проверяют тесты). Обычный счёт действует INVOICE_VALID_DAYS дней.
 *
 * Доплата и переход на год считаются от остатка текущего срока: оплата после
 * его конца ушла бы на ручной разбор. Поэтому такой счёт действует не дольше
 * срока — до конца последнего полного дня по Москве перед ним: в счёте,
 * письме и кабинете печатается дата без часов, и она должна быть верной
 * целиком. Исключение — когда счёт выставлен в этот последний полный день
 * (до его конца меньше суток), а срок кончается вечером, после 20:00 МСК:
 * тогда счёт действует до самого конца срока — день окончания почти целый
 * (напечатанная дата может обещать до четырёх часов лишних; оплата в эти
 * часы уйдёт на ручной разбор).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MSK_OFFSET_MS = 3 * HOUR_MS;
/** С этого часа (МСК) день окончания срока считается почти целым. */
const EVENING_HOUR_MSK = 20;

/** Конец последнего полного дня по Москве перед `end` (23:59:59.999 МСК). */
export function lastFullMskDayBefore(end: Date): Date {
  const shifted = new Date(end.getTime() + MSK_OFFSET_MS);
  const dayStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - MSK_OFFSET_MS;
  return new Date(dayStart - 1);
}

export function invoiceDeadline(args: { now: Date; changeKind: string | null | undefined; termEnd: Date | null | undefined }): Date {
  const validUntil = new Date(args.now.getTime() + INVOICE_VALID_DAYS * DAY_MS);
  const capped = args.changeKind === "upgrade" || args.changeKind === "switch";
  if (!capped || !args.termEnd) return validUntil;
  const termEnd = args.termEnd;
  const lastDayEnd = lastFullMskDayBefore(termEnd);
  // Сколько прошло от полуночи МСК дня окончания до конца срока.
  const endHourMs = termEnd.getTime() - (lastDayEnd.getTime() + 1);
  const shortWindow = lastDayEnd.getTime() - args.now.getTime() < DAY_MS;
  const useTermEnd =
    lastDayEnd.getTime() <= args.now.getTime() || (shortWindow && endHourMs >= EVENING_HOUR_MSK * HOUR_MS);
  const deadline = useTermEnd ? termEnd : lastDayEnd;
  return deadline.getTime() < validUntil.getTime() ? deadline : validUntil;
}
