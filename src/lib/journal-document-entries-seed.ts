import { db } from "@/lib/db";
import { loadLegacyEligibleEmployees } from "@/lib/journal-automation-staff";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";

/**
 * Per-journal seeder для JournalDocumentEntry — создаёт «строки» на
 * каждый день периода (или per-employee) при создании документа.
 *
 * Без этого:
 *   • climate_control / cold_equipment / fryer_oil / uv_lamp /
 *     disinfectant — открываешь документ, видишь «Записей нет».
 *   • bulk-assign-today находит документ, но adapterDoc.rows = []
 *     (потому что rows читаются из entries) → «у журнала нет строк».
 *
 * Не сидим:
 *   • finished_product / perishable_rejection / intensive_cooling /
 *     accident / complaint / pest / audit_* / equipment_calibration /
 *     equipment_maintenance / breakdown / glass_items / med_books /
 *     training_plan / staff_training / ppe / traceability /
 *     metal_impurity — это event-based журналы, строки появляются
 *     по факту (приёмка груза, ЧП, инструктаж и т.д.).
 *
 * Для hygiene / health_check / cleaning сидим per-employee per-day:
 *   мы знаем eligibleUserIds (из JobPositionJournalAccess) — для каждого
 *   юзера и каждой даты создаём пустую entry.
 *
 * Для остальных per-day используем responsibleUserId как employeeId.
 */

export type EntrySeedResult = {
  created: number;
  skipped: number;
};

/** Журналы где сидим одну запись на день, employeeId = responsibleUserId. */
const PER_DAY_JOURNALS = new Set<string>([
  "climate_control",
  "cold_equipment_control",
  "cleaning_ventilation_checklist",
  "glass_control",
  "fryer_oil",
  // uv_lamp_runtime СОЗНАТЕЛЬНО не сидим (P8): на эталоне таблица
  // наработки бактерицидной установки при создании документа ПУСТАЯ —
  // строки заводит оператор вручную или автозаполнение. Сидер же
  // штамповал 13 дневных записей сразу, и новый документ открывался
  // «уже заполненным» пустыми строками. Существующие записи не трогаем.
  "disinfectant_usage",
]);

/** Журналы где сидим одну запись на день на каждого eligible-сотрудника. */
const PER_EMPLOYEE_PER_DAY_JOURNALS = new Set<string>([
  "hygiene",
  "health_check",
]);

/** Сидим только в начале периода (одна запись), не каждый день. */
const ONE_OFF_JOURNALS = new Set<string>([
  // ничего пока — оставляем пустым; добавим когда понадобится
]);

function buildDailyDates(dateFrom: Date, dateTo: Date): Date[] {
  const out: Date[] = [];
  const from = new Date(
    Date.UTC(
      dateFrom.getUTCFullYear(),
      dateFrom.getUTCMonth(),
      dateFrom.getUTCDate()
    )
  );
  const to = new Date(
    Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), dateTo.getUTCDate())
  );
  // Защита от слишком длинных периодов (например, 1 год — это 365
  // entries, нормально). Если вдруг 10 лет — обрежем на 366 дней.
  const MAX_DAYS = 380;
  let d = new Date(from);
  let i = 0;
  while (d <= to && i < MAX_DAYS) {
    out.push(new Date(d));
    d = new Date(d.getTime() + 24 * 3600_000);
    i += 1;
  }
  return out;
}

export async function seedEntriesForDocument(input: {
  documentId: string;
  journalCode: string;
  organizationId: string;
  dateFrom: Date;
  dateTo: Date;
  responsibleUserId: string | null;
  /**
   * Готовый список сотрудников-строк (per-employee журналы). Передаётся
   * автоматикой, когда у журнала задана политика `staff` — тогда сидер не
   * считает состав сам, а сеет ровно тех, кого выбрал резолвер
   * (`resolveAutomationStaff`). Не передан — легаси-путь: должности из
   * `JobPositionJournalAccess`, иначе весь активный ростер.
   */
  employeeIds?: string[];
  /** Точка документа: легаси-состав — только её сотрудники. */
  buildingId?: string | null;
}): Promise<EntrySeedResult> {
  const {
    documentId,
    journalCode,
    organizationId,
    dateFrom,
    dateTo,
    responsibleUserId,
  } = input;

  if (
    !PER_DAY_JOURNALS.has(journalCode) &&
    !PER_EMPLOYEE_PER_DAY_JOURNALS.has(journalCode) &&
    !ONE_OFF_JOURNALS.has(journalCode)
  ) {
    return { created: 0, skipped: 0 };
  }

  const dates = buildDailyDates(dateFrom, dateTo);
  if (dates.length === 0) return { created: 0, skipped: 0 };

  // PER_DAY: одна entry на день, employeeId = responsibleUserId.
  if (PER_DAY_JOURNALS.has(journalCode)) {
    // Строка на каждый день пишется на ответственного — поэтому он обязан
    // быть сотрудником этой организации (не ROOT, не чужой, не архивный).
    const responsible = responsibleUserId
      ? await db.user.findFirst({
          where: { id: responsibleUserId, organizationId, ...ORG_ROSTER_WHERE },
          select: { id: true },
        })
      : null;
    if (!responsible) {
      // Нет ответственного — без него мы не можем сидеть entry
      // (employeeId is non-null FK на User).
      return { created: 0, skipped: dates.length };
    }
    const result = await db.journalDocumentEntry.createMany({
      data: dates.map((date) => ({
        documentId,
        employeeId: responsible.id,
        date,
        // Маркер «авто-сид»: эта entry создана при создании документа,
// чтобы у журнала появилась структура rows. Заполненной её
// считать НЕЛЬЗЯ — иначе compliance-метрики и баннер «уже
// заполнялся» врут. После того как сотрудник сохранит запись
// — upsert перезатирает data, и маркер исчезает.
data: { _autoSeeded: true } as never,
      })),
      skipDuplicates: true,
    });
    return { created: result.count, skipped: dates.length - result.count };
  }

  // PER_EMPLOYEE_PER_DAY: для каждого сотрудника, чья должность входит
  // в JobPositionJournalAccess для этого шаблона — entry на каждый
  // день. Если access не настроен — берём всех active employees орги.
  if (PER_EMPLOYEE_PER_DAY_JOURNALS.has(journalCode)) {
    // Состав строк: либо готовый список от автоматики, либо легаси-расчёт
    // (одна реализация на оба пути — см. journal-automation-staff.ts).
    const seedEmployeeIds =
      input.employeeIds && input.employeeIds.length > 0
        ? input.employeeIds
        : await loadLegacyEligibleEmployees(db, {
            organizationId,
            templateCode: journalCode,
            buildingId: input.buildingId,
          });

    if (seedEmployeeIds.length === 0) {
      return { created: 0, skipped: dates.length };
    }

    const rows = [];
    for (const employeeId of seedEmployeeIds) {
      for (const date of dates) {
        rows.push({
          documentId,
          employeeId,
          date,
          // Маркер «авто-сид»: эта entry создана при создании документа,
// чтобы у журнала появилась структура rows. Заполненной её
// считать НЕЛЬЗЯ — иначе compliance-метрики и баннер «уже
// заполнялся» врут. После того как сотрудник сохранит запись
// — upsert перезатирает data, и маркер исчезает.
data: { _autoSeeded: true } as never,
        });
      }
    }
    const result = await db.journalDocumentEntry.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return { created: result.count, skipped: rows.length - result.count };
  }

  return { created: 0, skipped: 0 };
}
