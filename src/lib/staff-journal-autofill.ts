/**
 * Автозаполнение «кадровых» журналов (гигиенический + журнал здоровья).
 *
 * Используется двумя точками входа:
 *   - POST /api/journal-documents/[id]/staff  (action=apply_auto_fill) —
 *     менеджер включает тумблер «Автоматически заполнять журнал»;
 *   - POST /api/cron/auto-fill-journals — ежедневный cron, дозаполняет
 *     ТОЛЬКО сегодняшний день.
 *
 * Правило эталона (haccp-online):
 *   - тумблер автозаполнения работает ЕЖЕДНЕВНО, а не однократно;
 *   - графики сотрудников (выходные / отпуска / больничные) проставляют
 *     статус ТОЛЬКО в ГИГИЕНИЧЕСКОМ журнале. На журнал здоровья и на
 *     любые другие журналы графики не влияют.
 *
 * Идемпотентность: пишем только в ПУСТЫЕ ячейки (и создаём недостающие
 * строки через createMany + skipDuplicates). Повторный прогон по уже
 * заполненному дню не делает ни одной записи.
 */
import type { PrismaClient } from "@prisma/client";
import {
  getDefaultEntryDataForTemplate,
  isEntryDataEmpty,
  toDateKey,
  type HygieneEntryData,
} from "@/lib/hygiene-document";
import {
  buildDayOffOverrides,
  dayOffOverrideKey,
  isStaffDayOff,
} from "@/lib/staff-days-off";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";

export const HYGIENE_TEMPLATE_CODE = "hygiene";
export const HEALTH_CHECK_TEMPLATE_CODE = "health_check";

export const STAFF_JOURNAL_TEMPLATE_CODES = [
  HYGIENE_TEMPLATE_CODE,
  HEALTH_CHECK_TEMPLATE_CODE,
] as const;

/** Статусы гигиенического журнала, которые может проставить график. */
export type StaffScheduleStatus = "day_off" | "vacation" | "sick_leave";

type ScheduleDb = Pick<
  PrismaClient,
  "staffWorkOffDay" | "staffVacation" | "staffSickLeave" | "user"
>;

type EntryDb = Pick<PrismaClient, "journalDocumentEntry">;

export type StaffScheduleMap = Map<string, StaffScheduleStatus>;

/**
 * То же, что `StaffScheduleMap`, но с датой окончания периода — она нужна
 * приложению, чтобы сказать «отпуск до 25.09», а не просто «отпуск».
 * `untilKey` пуст у обычного выходного (он всегда на один день).
 */
export type StaffScheduleDetail = {
  status: StaffScheduleStatus;
  untilKey: string | null;
};

export type StaffScheduleDetailMap = Map<string, StaffScheduleDetail>;

export function staffScheduleKey(employeeId: string, dateKey: string) {
  return `${employeeId}:${dateKey}`;
}

function utcDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/**
 * Автозаполнение никогда не трогает будущее: отметки «здоров» и подписи
 * ставятся только за прошедшие дни и сегодня, дальше — cron по одному дню.
 * `todayKey` — ключ сегодняшнего дня; по умолчанию UTC-дата сервера, как в
 * cron `auto-fill-journals`.
 */
export function limitDateKeysToToday(
  dateKeys: readonly string[],
  todayKey: string = toDateKey(new Date())
): string[] {
  return dateKeys.filter((dateKey) => dateKey <= todayKey);
}

/**
 * Читает графики (выходные / отпуска / больничные) на диапазон дат и
 * складывает в map `employeeId:dateKey -> статус`.
 *
 * Приоритет при пересечении: больничный > отпуск > выходной.
 */
export async function loadStaffScheduleMap(
  db: ScheduleDb,
  params: {
    employeeIds: string[];
    dateKeys: string[];
    /**
     * Организация документа. id сотрудников приходят снаружи (строки
     * документа, выбор ассистента), поэтому недельные правила выходных
     * читаем только у людей этой организации.
     */
    organizationId?: string;
  }
): Promise<StaffScheduleMap> {
  const detail = await loadStaffScheduleDetailMap(db, params);
  const map: StaffScheduleMap = new Map();
  detail.forEach((value, key) => map.set(key, value.status));
  return map;
}

/**
 * Полная версия: статус + дата окончания периода. Её же использует
 * приложение сотрудника, чтобы показать «отпуск до 25.09».
 */
export async function loadStaffScheduleDetailMap(
  db: ScheduleDb,
  params: {
    employeeIds: string[];
    dateKeys: string[];
    organizationId?: string;
  }
): Promise<StaffScheduleDetailMap> {
  const map: StaffScheduleDetailMap = new Map();
  const { employeeIds } = params;
  const dateKeys = [...params.dateKeys].sort();
  if (employeeIds.length === 0 || dateKeys.length === 0) return map;

  const rangeStart = utcDate(dateKeys[0]);
  const rangeEnd = utcDate(dateKeys[dateKeys.length - 1]);
  const dateKeySet = new Set(dateKeys);

  const [offDays, staffUsers, vacations, sickLeaves] = await Promise.all([
    db.staffWorkOffDay.findMany({
      where: {
        userId: { in: employeeIds },
        date: { gte: rangeStart, lte: rangeEnd },
      },
      select: { userId: true, date: true, kind: true },
    }),
    // Недельное правило выходных: без него в журнал попадали только те
    // дни, которые управляющая успела прокликать руками.
    db.user.findMany({
      where: {
        id: { in: employeeIds },
        ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      },
      select: { id: true, weeklyDaysOff: true },
    }),
    db.staffVacation.findMany({
      where: {
        userId: { in: employeeIds },
        dateFrom: { lte: rangeEnd },
        dateTo: { gte: rangeStart },
      },
      select: { userId: true, dateFrom: true, dateTo: true },
    }),
    db.staffSickLeave.findMany({
      where: {
        userId: { in: employeeIds },
        dateFrom: { lte: rangeEnd },
        dateTo: { gte: rangeStart },
      },
      select: { userId: true, dateFrom: true, dateTo: true },
    }),
  ]);

  // Порядок важен: последующий тип перекрывает предыдущий.
  // Выходной = недельное правило сотрудника, скорректированное явными
  // отметками из StaffWorkOffDay (см. src/lib/staff-days-off.ts).
  const overrides = buildDayOffOverrides(
    offDays.filter((row) => dateKeySet.has(toDateKey(row.date)))
  );
  staffUsers.forEach((user) => {
    dateKeys.forEach((dateKey) => {
      const override = overrides.get(dayOffOverrideKey(user.id, dateKey));
      if (!isStaffDayOff(user, dateKey, override ?? null)) return;
      map.set(staffScheduleKey(user.id, dateKey), {
        status: "day_off",
        untilKey: null,
      });
    });
  });

  function applyPeriods(
    periods: { userId: string; dateFrom: Date; dateTo: Date }[],
    status: StaffScheduleStatus
  ) {
    periods.forEach((period) => {
      const from = toDateKey(period.dateFrom);
      const to = toDateKey(period.dateTo);
      dateKeys.forEach((dateKey) => {
        if (dateKey < from || dateKey > to) return;
        map.set(staffScheduleKey(period.userId, dateKey), {
          status,
          untilKey: to,
        });
      });
    });
  }

  applyPeriods(vacations, "vacation");
  applyPeriods(sickLeaves, "sick_leave");

  return map;
}

/**
 * Данные строки автозаполнения. Для гигиенического — статус из графика
 * («В» / «Отп» / «Б/л»), иначе дефолт («Зд.»). Для журнала здоровья —
 * всегда дефолт: графики на него не влияют (правило эталона).
 */
export function buildStaffAutoFillEntryData(
  templateCode: string,
  scheduleStatus?: StaffScheduleStatus
) {
  if (scheduleStatus) {
    if (templateCode === HYGIENE_TEMPLATE_CODE) {
      return {
        status: scheduleStatus,
        temperatureAbove37: null,
      } satisfies HygieneEntryData;
    }
    // Журнал здоровья: в выходной, отпуск и больничный сотрудник не выходит
    // на смену — подписи нет, ячейка остаётся пустой.
    return {};
  }

  return getDefaultEntryDataForTemplate(templateCode);
}

export type StaffAutoFillEntry = {
  id: string;
  employeeId: string;
  date: Date;
  data: unknown;
};

/**
 * Дозаполняет строки кадрового журнала на переданные даты.
 *
 * @param employeeIds сотрудники, для которых должны существовать строки
 * @param dateKeys    даты в формате YYYY-MM-DD (для cron — только сегодня);
 *                    даты после сегодня отбрасываются всегда
 * @param entries     уже существующие строки документа
 */
export async function applyStaffJournalAutoFill(
  db: EntryDb & ScheduleDb,
  params: {
    documentId: string;
    /** Организация документа: строки заводим только на её сотрудников. */
    organizationId: string;
    templateCode: string;
    employeeIds: string[];
    dateKeys: string[];
    entries: StaffAutoFillEntry[];
  }
): Promise<{ created: number; updated: number }> {
  const { documentId, organizationId, templateCode, entries } = params;
  // Будущие дни не заполняются ни тумблером, ни добавлением сотрудника.
  const dateKeys = limitDateKeysToToday(params.dateKeys);
  if (dateKeys.length === 0) return { created: 0, updated: 0 };

  // Новые строки — только живым сотрудникам этой организации. Список
  // приходит из политики автоматики и строк документа; пользователь другой
  // организации (партнёр, ROOT) или уволенный строку в журнале не получает.
  const allowedEmployees =
    params.employeeIds.length > 0
      ? await db.user.findMany({
          where: {
            id: { in: params.employeeIds },
            organizationId,
            ...ORG_ROSTER_WHERE,
          },
          select: { id: true },
        })
      : [];
  const allowedIds = new Set(allowedEmployees.map((user) => user.id));
  const employeeIds = params.employeeIds.filter((id) => allowedIds.has(id));

  // График выходных, отпусков и больничных — для обоих кадровых журналов:
  // гигиена ставит статус дня, здоровье оставляет ячейку пустой.
  const schedule = await loadStaffScheduleMap(db, { employeeIds, dateKeys, organizationId });

  // «Допуск по QR» (2026-09-22): сотрудник отмечается сам — «Здоров» и
  // подпись за него не ставим, только статусы из графика (выходной,
  // отпуск, больничный). Иначе сводка «кто не отметился» теряет смысл.
  const orgClient = (db as { organization?: Pick<PrismaClient, "organization">["organization"] }).organization;
  const qrAdmission = orgClient
    ? (await orgClient.findUnique({ where: { id: organizationId }, select: { healthQrRequired: true } }).catch(() => null))
        ?.healthQrRequired === true
    : false;
  const autoFillAllowed = (employeeId: string, dateKey: string) =>
    !qrAdmission || schedule.has(staffScheduleKey(employeeId, dateKey));

  const dateKeySet = new Set(dateKeys);
  const existingKeys = new Set(
    entries.map((entry) => staffScheduleKey(entry.employeeId, toDateKey(entry.date)))
  );

  const rowsToCreate = employeeIds.flatMap((employeeId) =>
    dateKeys
      .filter((dateKey) => !existingKeys.has(staffScheduleKey(employeeId, dateKey)))
      .filter((dateKey) => autoFillAllowed(employeeId, dateKey))
      .map((dateKey) => ({
        documentId,
        employeeId,
        date: utcDate(dateKey),
        data: buildStaffAutoFillEntryData(
          templateCode,
          schedule.get(staffScheduleKey(employeeId, dateKey))
        ),
      }))
  );

  const created =
    rowsToCreate.length > 0
      ? (
          await db.journalDocumentEntry.createMany({
            data: rowsToCreate,
            skipDuplicates: true,
          })
        ).count
      : 0;

  // Дозаполняем только ПУСТЫЕ ячейки — ручные отметки не перетираем.
  const rowsToUpdate = entries.filter((entry) => {
    const dateKey = toDateKey(entry.date);
    if (!dateKeySet.has(dateKey) || !isEntryDataEmpty(entry.data)) return false;
    if (!autoFillAllowed(entry.employeeId, dateKey)) return false;
    // Пустую ячейку выходного (журнал здоровья) не перезаписываем пустотой.
    return !isEntryDataEmpty(
      buildStaffAutoFillEntryData(templateCode, schedule.get(staffScheduleKey(entry.employeeId, dateKey)))
    );
  });

  await Promise.all(
    rowsToUpdate.map((entry) =>
      db.journalDocumentEntry.update({
        where: { id: entry.id },
        data: {
          data: buildStaffAutoFillEntryData(
            templateCode,
            schedule.get(staffScheduleKey(entry.employeeId, toDateKey(entry.date)))
          ),
        },
      })
    )
  );

  return { created, updated: rowsToUpdate.length };
}
