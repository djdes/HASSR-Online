import { isManagementRole } from "@/lib/user-roles";

/**
 * Кто и что вправе править в документе-бланке.
 *
 * Модуль намеренно чистый: ни Prisma, ни `db`, ни серверных импортов.
 * Ровно те же правила нужны браузеру — сетка должна ГАСИТЬ недоступные
 * ячейки, а не позволять их трогать и ловить отказ уже на сохранении.
 * Пока логика жила рядом с записью в базу, клиент импортировать её не
 * мог, и сотрудник видел редактируемую таблицу, из которой ничего не
 * сохранялось.
 */

/**
 * Кто в этом документе имеет полный доступ.
 *
 * Руководство и ответственный за журнал правят любые строки и любые дни
 * — им положено исправлять чужие ошибки, в том числе вчерашние. Рядовой
 * сотрудник заполняет только свою строку и только сегодня: журнал
 * санитарного контроля — это подтверждение, что проверка была проведена
 * в тот день, а запись задним числом такого подтверждения не даёт.
 */
export function hasFullDocumentAccess(args: {
  actor: { id: string; role: string; isRoot: boolean };
  responsibleUserId?: string | null;
}): boolean {
  if (args.actor.isRoot) return true;
  if (isManagementRole(args.actor.role)) return true;
  return Boolean(
    args.responsibleUserId && args.responsibleUserId === args.actor.id
  );
}

/**
 * Тексты отказов держим здесь же: их показывает и сервер в ответе, и
 * сетка в подсказке над закрытой ячейкой. Разъехавшиеся формулировки
 * читаются как два разных запрета.
 */
export const FOREIGN_ROW_MESSAGE = "Можно заполнять только свою строку";
export const NOT_TODAY_MESSAGE =
  "Заполнять можно только сегодняшний день. За прошлые дни правки вносит ответственный за журнал.";

/**
 * Попытка заполнить журнал ВПЕРЁД.
 *
 * Журнал — доказательство того, что уже сделано. Отметка «Здоров» на
 * послезавтра или мойка оборудования будущим числом обесценивают
 * документ на проверке, поэтому запрет одинаков для всех — ни у
 * управляющей, ни у ROOT нет причин записывать будущее. Сетка гасит
 * такие ячейки этим же текстом, что и сервер в 403.
 */
export const FUTURE_DAY_LOCKED_MESSAGE =
  "Нельзя заполнять журнал будущим числом: запись вносится в день, когда работа выполнена.";

export type EntryScopeDecision =
  | { allowed: true }
  | { allowed: false; error: string; code: "foreign_row" | "not_today" };

/**
 * «Правка прошлых дней» спецрежима (2026-11-25): разрешена ли правка
 * прошлых дней и на сколько последних дней (`null` — без ограничения).
 * Сервер берёт её из настройки спецрежима (`pastDaysPolicy`), сетка — из
 * пропсов страницы документа.
 */
export type PastDaysPolicy = { allowed: boolean; limitDays: number | null };

/** День `YYYY-MM-DD`, сдвинутый на `days` дней (отрицательные — назад). */
export function shiftDayKey(dayKey: string, days: number): string {
  const date = new Date(`${dayKey.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Открыт ли прошлый день спецрежимом: правка прошлых дней разрешена, день
 * строго раньше сегодняшнего и не старше окна (`limitDays` последних дней:
 * 1 — только вчера). Сегодня и будущее этим правилом не открываются —
 * сегодня открыто и так, будущее закрыто всегда.
 */
export function pastDayOpen(policy: PastDaysPolicy | null | undefined, dayKey: string, todayKey: string): boolean {
  if (!policy?.allowed || !todayKey || !dayKey) return false;
  const day = dayKey.slice(0, 10);
  if (!(day < todayKey)) return false;
  return policy.limitDays === null || day >= shiftDayKey(todayKey, -policy.limitDays);
}

/** Отказ сотруднику за пределами окна спецрежима — с глубиной окна. */
export function pastDaysWindowMessage(limitDays: number): string {
  if (limitDays === 1) return "Прошлые записи можно менять только за вчерашний день.";
  const mod10 = limitDays % 10;
  const mod100 = limitDays % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return `Прошлые записи можно менять только за последние ${limitDays} ${word}.`;
}

/**
 * Чья строка и за какой день — проверка ДО правил закрытого дня.
 *
 * Отдельно от `checkEntryWrite`, потому что отвечает на другой вопрос:
 * тот решает «не поздно ли править», этот — «твоё ли это вообще».
 */
export function checkEntryScope(args: {
  actor: { id: string; role: string; isRoot: boolean };
  responsibleUserId?: string | null;
  /** Чья строка правится. */
  employeeId: string;
  /** День строки, `YYYY-MM-DD`. */
  entryDayKey: string;
  /** Сегодня в часовом поясе организации, `YYYY-MM-DD`. */
  todayKey: string;
  /** «Правка прошлых дней» спецрежима — открывает сотруднику прошлые дни в окне. */
  pastDays?: PastDaysPolicy | null;
}): EntryScopeDecision {
  if (hasFullDocumentAccess(args)) return { allowed: true };

  if (args.employeeId !== args.actor.id) {
    return {
      allowed: false,
      error: FOREIGN_ROW_MESSAGE,
      code: "foreign_row",
    };
  }

  if (args.entryDayKey !== args.todayKey && !pastDayOpen(args.pastDays, args.entryDayKey, args.todayKey)) {
    const beyondWindow = args.pastDays?.allowed === true && args.pastDays.limitDays !== null && args.entryDayKey < args.todayKey;
    return {
      allowed: false,
      error: beyondWindow ? pastDaysWindowMessage(args.pastDays!.limitDays!) : NOT_TODAY_MESSAGE,
      code: "not_today",
    };
  }

  return { allowed: true };
}
