/**
 * «Сегодня сотрудник отсутствует» — один ответ для всего приложения.
 *
 * ПОЧЕМУ: отпуска, больничные и постоянные выходные до этого читало
 * только автозаполнение кадровых журналов. Панель контроля, «Моя команда»
 * и «Напомнить всем» про них не знали — человек в отпуске висел красным
 * «не взял задачи» и получал напоминания в Telegram, хотя на вкладках
 * графиков написано обратное.
 *
 * Правило (решение владельца): задачи в приложении сотруднику НЕ прячем —
 * он может выйти на подмену. Мы лишь перестаём считать его должником и
 * не шлём ему напоминания, а в приложении показываем спокойную плашку.
 *
 * Источник данных — тот же, что у автозаполнения гигиены
 * (`loadStaffScheduleDetailMap`), чтобы экран и журнал не расходились.
 */
import {
  loadStaffScheduleDetailMap,
  staffScheduleKey,
  type StaffScheduleStatus,
} from "@/lib/staff-journal-autofill";

export type StaffAbsence = {
  status: StaffScheduleStatus;
  /** Последний день периода (YYYY-MM-DD). У выходного — пусто. */
  untilKey: string | null;
};

type AbsenceDb = Parameters<typeof loadStaffScheduleDetailMap>[0];

/** «отпуск», «больничный», «выходной» — для подписи на экране. */
export const STAFF_ABSENCE_LABEL: Record<StaffScheduleStatus, string> = {
  vacation: "отпуск",
  sick_leave: "больничный",
  day_off: "выходной",
};

/**
 * Кто из перечисленных сотрудников сегодня не работает по графику.
 *
 * @param dateKey день организации в формате YYYY-MM-DD
 */
export async function loadStaffAbsenceForDay(
  db: AbsenceDb,
  params: {
    organizationId: string;
    employeeIds: string[];
    dateKey: string;
  }
): Promise<Map<string, StaffAbsence>> {
  const result = new Map<string, StaffAbsence>();
  if (params.employeeIds.length === 0) return result;

  const detail = await loadStaffScheduleDetailMap(db, {
    employeeIds: params.employeeIds,
    dateKeys: [params.dateKey],
    organizationId: params.organizationId,
  });

  params.employeeIds.forEach((employeeId) => {
    const hit = detail.get(staffScheduleKey(employeeId, params.dateKey));
    if (hit) result.set(employeeId, hit);
  });
  return result;
}

/** Сотрудник отсутствует сегодня? Короткая форма для одного человека. */
export async function isStaffAbsentOnDay(
  db: AbsenceDb,
  params: { organizationId: string; employeeId: string; dateKey: string }
): Promise<StaffAbsence | null> {
  const map = await loadStaffAbsenceForDay(db, {
    organizationId: params.organizationId,
    employeeIds: [params.employeeId],
    dateKey: params.dateKey,
  });
  return map.get(params.employeeId) ?? null;
}

/**
 * Подпись для приложения: «Сегодня у вас по графику: отпуск до 25.09».
 * Чистая функция — берёт готовый `StaffAbsence`, в БД не ходит.
 */
export function formatStaffAbsenceNote(absence: StaffAbsence): string {
  const label = STAFF_ABSENCE_LABEL[absence.status];
  if (!absence.untilKey) return `Сегодня у вас по графику: ${label}`;
  const [, month, day] = absence.untilKey.split("-");
  return `Сегодня у вас по графику: ${label} до ${day}.${month}`;
}
