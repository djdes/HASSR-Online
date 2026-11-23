import type { ManagerScope } from "@/lib/manager-scope";
import { PER_EMPLOYEE_DAILY_JOURNAL_CODES } from "@/lib/daily-journal-codes";
import type { AdapterRow } from "@/lib/tasksflow-adapters/types";

export type BulkJournalTemplate = {
  id: string;
  code: string;
  name: string;
  /** Премия за выполнение в копейках. Если > 0 — задача отправляется
   *  всем eligible сотрудникам (race-for-bonus), а не одному. */
  bonusAmountKopecks?: number;
  /** 'personal' (закрепленная задача) или 'shared' (общая очередь
   *  записей). TF Dashboard разделяет на 2 таба. */
  taskScope?: string;
};

export type BulkJournalSkip = {
  template: BulkJournalTemplate;
  reason: string;
};

export type BulkRowSelection = {
  rows: AdapterRow[];
  alreadyLinked: number;
  skipReason?: string;
};

export function parseStringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string")
    : [];
}

export function isPerEmployeeBulkJournal(journalCode: string): boolean {
  return PER_EMPLOYEE_DAILY_JOURNAL_CODES.has(journalCode);
}

/**
 * Журналы, которые ведутся ОДНОЙ КОМАНДОЙ — любой из ответственных
 * может закрыть запись от лица команды. Задача fan-out'ится на всех
 * eligible; первый кто сделает — у остальных карточка автоматически
 * уходит в «Сделано другими» (claimedByWorkerId выставляется на
 * стороне TasksFlow). Отличие от bonus-fan-out: денег не начисляем,
 * но это удобный race-for-completion для смены из N человек.
 */
const TEAM_FAN_OUT_CODES = new Set<string>([
  "intensive_cooling",              // повара горячего цеха
  "fryer_oil",                      // фритюр — те же повара
  "uv_lamp_runtime",                // УФ-лампа — уборщики/менеджер
  "cleaning_ventilation_checklist", // уборка-проветривание — команда
  "disinfectant_usage",             // дезсредства — кто доставал
  "climate_control",                // замер t°/влажности — кто в смене
  "cold_equipment_control",         // замер холодильников — повара
  // 2026-04-30: расширили после жалобы менеджера на «13 журналов
  // не отправлены». Все они на самом деле team-based — кто из смены
  // делает, тот и пишет. Раньше требовали responsibleUserId который
  // часто пустой / на уволенного → задачи не разлетались.
  "cleaning",                       // журнал уборки — кто из смены убирался
  "general_cleaning",               // ген. уборка — команда
  "sanitary_day_checklist",         // санитарный день — команда
  "equipment_cleaning",             // мойка/дезинфекция оборудования
  "glass_control",                  // контроль стекла — кто проверяет
  "finished_product",               // бракераж готовой продукции — повар/тех.
  "accident",                       // акт забраковки — любой кто заметил
  "perishable_rejection",           // отбраковка скоропортящихся
  "metal_impurity",                 // контроль металлопримесей
  "ppe_issuance",                   // СИЗ — менеджер/завхоз
  "pest_control",                   // дератизация
  "complaint_register",             // регистр жалоб
]);

export function isTeamFanOutJournal(journalCode: string): boolean {
  return TEAM_FAN_OUT_CODES.has(journalCode);
}

/**
 * Журнал уборки в rooms-режиме раздаёт задачи по зонам явно
 * (`room::<roomId>::cleaner::<uid>`): закрепления, гонка или поровну —
 * решение менеджера. Синтетический fan-out «всем на смене» поверх него
 * не нужен. Возвращает true, когда адаптер уже дал такие строки.
 */
export function hasExplicitPerRowDistribution(
  journalCode: string,
  rows: ReadonlyArray<Pick<AdapterRow, "rowKey">>,
): boolean {
  if (journalCode !== "cleaning") return false;
  return rows.some((row) => row.rowKey.startsWith("room::"));
}

/**
 * Должна ли задача рассылаться всем eligible-сотрудникам (а не одному).
 *
 * Случаи:
 *   1. Per-employee журнал (hygiene / health_check) — каждый ведёт сам.
 *   2. Team-журнал (intensive_cooling, fryer_oil, …) — fan-out на всех
 *      eligible, первый закрывает у остальных.
 *   3. Журнал с премией > 0 — все видят, кто первый сделал, тому бонус
 *      (race-for-bonus).
 */
export function shouldFanOutToAll(template: {
  code: string;
  bonusAmountKopecks?: number;
}): boolean {
  if (isPerEmployeeBulkJournal(template.code)) return true;
  if (isTeamFanOutJournal(template.code)) return true;
  if ((template.bonusAmountKopecks ?? 0) > 0) return true;
  return false;
}

export function canBulkAssignJournal(
  scope: Pick<ManagerScope, "assignableJournalCodes"> | null,
  journalCode: string
): boolean {
  if (!scope) return true;
  if (scope.assignableJournalCodes.length === 0) return true;
  return scope.assignableJournalCodes.includes(journalCode);
}

export function selectBulkJournalTemplates(args: {
  templates: BulkJournalTemplate[];
  disabledCodes: Set<string>;
  filledTemplateIds: Set<string>;
  scope: Pick<ManagerScope, "assignableJournalCodes"> | null;
}): { targets: BulkJournalTemplate[]; skipped: BulkJournalSkip[] } {
  const targets: BulkJournalTemplate[] = [];
  const skipped: BulkJournalSkip[] = [];

  for (const template of args.templates) {
    if (args.disabledCodes.has(template.code)) continue;
    if (args.filledTemplateIds.has(template.id)) continue;

    if (!canBulkAssignJournal(args.scope, template.code)) {
      skipped.push({
        template,
        reason: "Журнал не разрешён этому менеджеру в иерархии",
      });
      continue;
    }

    targets.push(template);
  }

  return { targets, skipped };
}

function noEligibleRowReason(args: {
  rows: AdapterRow[];
  onDutyUserIds: Set<string>;
  linkedUserIds: Set<string>;
  /** true когда фильтрация по WorkShift включена. Иначе onDutyUserIds —
   *  это просто scope менеджера, и текст про «смену» вводит в
   *  заблуждение. */
  respectShifts: boolean;
}): string {
  if (args.onDutyUserIds.size === 0) {
    return args.respectShifts
      ? "Никто из вашей зоны не стоит в смене сегодня"
      : "В вашей зоне нет активных сотрудников";
  }

  const responsibleRows = args.rows.filter((row) => row.responsibleUserId);
  if (responsibleRows.length === 0) {
    return "В журнале не указан ответственный сотрудник";
  }

  const onDutyRows = responsibleRows.filter((row) =>
    args.onDutyUserIds.has(row.responsibleUserId ?? "")
  );
  if (onDutyRows.length === 0) {
    return args.respectShifts
      ? "Ответственные по журналу не стоят в смене сегодня"
      : "Ответственный по журналу уволен или не в вашей зоне";
  }

  const linkedRows = onDutyRows.filter((row) =>
    args.linkedUserIds.has(row.responsibleUserId ?? "")
  );
  if (linkedRows.length === 0) {
    return "Ответственные не привязаны к программному модулю (нет телефона)";
  }

  return "Нет подходящей строки для назначения в программном модуле";
}

export function selectRowsForBulkAssign(args: {
  journalCode: string;
  /** Премия за журнал в копейках. Опциональна для обратной совместимости
   *  тестов; если опущена — fan-out только для per-employee. */
  bonusAmountKopecks?: number;
  rows: AdapterRow[];
  takenRowKeys: Set<string>;
  onDutyUserIds: Set<string>;
  linkedUserIds: Set<string>;
  /** true когда onDutyUserIds — это реально график смен; false когда
   *  это просто весь scope менеджера (без shift-фильтра). Влияет на
   *  текст ошибки и на fallback-поведение. */
  respectShifts?: boolean;
  /**
   * Phase fan-out v2: дополнительный pool кандидатов для fan-out
   * журналов (team / per-employee / bonus). Когда adapter возвращает
   * мало или вообще не возвращает rows с responsibleUserId, мы
   * синтезируем rows на этих юзеров. Включает всех eligible сотрудников
   * (active + scope + linked + position-filter если задан).
   *
   * Раньше fallback требовал `args.rows.length > 0` — этого было
   * недостаточно для адаптеров вроде cleaning, которые возвращали [],
   * если у пользователя нет config.responsiblePairs. Теперь fan-out
   * запускается даже на пустом adapter.rows.
   */
  fanOutCandidateIds?: Set<string>;
  /** Шаблон для synthetic rows когда adapter rows пуст. Если не задан —
   *  используем generic template. */
  fanOutLabel?: string;
}): BulkRowSelection {
  const fanOutToAll = shouldFanOutToAll({
    code: args.journalCode,
    bonusAmountKopecks: args.bonusAmountKopecks,
  });
  const respectShifts = args.respectShifts ?? false;

  if (!fanOutToAll && args.takenRowKeys.size > 0) {
    return { rows: [], alreadyLinked: 1 };
  }

  const responsibleRows = args.rows.filter((row) => row.responsibleUserId);
  const onDutyRows = responsibleRows.filter((row) =>
    args.onDutyUserIds.has(row.responsibleUserId ?? "")
  );
  const linkedOnDutyRows = onDutyRows.filter((row) =>
    args.linkedUserIds.has(row.responsibleUserId ?? "")
  );

  // ═══ NON-FAN-OUT (single-task journals) ═══
  if (!fanOutToAll) {
    if (linkedOnDutyRows.length === 0) {
      return {
        rows: [],
        alreadyLinked: 0,
        skipReason: noEligibleRowReason({ ...args, respectShifts }),
      };
    }
    const firstAvailable = linkedOnDutyRows.find(
      (row) => !args.takenRowKeys.has(row.rowKey)
    );
    if (!firstAvailable) {
      return { rows: [], alreadyLinked: 1 };
    }
    return { rows: [firstAvailable], alreadyLinked: 0 };
  }

  // ═══ FAN-OUT (per-employee / team / bonus journals) ═══
  // Стратегия:
  //   1. Собираем candidate user ids:
  //      • из adapter.rows (responsibleUserId которые linked + onDuty)
  //      • из fanOutCandidateIds (явный pool из endpoint)
  //   2. Для каждого user'а строим row:
  //      • если есть orig row для этого user'а — используем её
  //      • иначе synthetic с уникальным rowKey
  //   3. Skip только если ВООБЩЕ нет candidates.

  const candidateIds = new Set<string>();
  for (const row of linkedOnDutyRows) {
    if (row.responsibleUserId) candidateIds.add(row.responsibleUserId);
  }
  // Auto-fallback: если caller не передал fanOutCandidateIds — берём
  // intersection (onDutyUserIds ∩ linkedUserIds) как разумный default.
  // Caller-API endpoint всегда передаёт явный pool, но тесты и старые
  // call sites могут полагаться на этот fallback.
  const explicitPool = args.fanOutCandidateIds ?? (() => {
    const def = new Set<string>();
    for (const uid of args.onDutyUserIds) {
      if (args.linkedUserIds.has(uid)) def.add(uid);
    }
    return def;
  })();
  for (const uid of explicitPool) {
    if (args.linkedUserIds.has(uid)) candidateIds.add(uid);
  }

  if (candidateIds.size === 0) {
    return {
      rows: [],
      alreadyLinked: 0,
      skipReason: noEligibleRowReason({
        ...args,
        rows: args.rows,
        respectShifts,
      }),
    };
  }

  // 2026-05-04: новая логика фан-аута. Раньше дедуплицировали по
  // responsibleUserId (1 row per user), что ломало cleaning rooms-mode
  // — уборщица назначенная на 3 комнаты получала task только для
  // ПЕРВОЙ. Теперь:
  //   • Pass 1: создаём adapter row'ы как есть, дедуп ТОЛЬКО по rowKey
  //     (= уникальный room/area/equipment + user). Если адаптер дал
  //     2 row'a с тем же uid но разными roomId — оба остаются.
  //   • Pass 2: для users в candidateIds которым адаптер вообще не
  //     дал ни одной row'и — synthetic fanout-row.

  const rowsToCreate: AdapterRow[] = [];
  const seenRowKeys = new Set<string>();
  const usersWithAdapterRow = new Set<string>();
  let alreadyLinkedCount = 0;

  // Pass 1: preserve per-row metadata (room/area/equipment).
  for (const row of args.rows) {
    const uid = row.responsibleUserId;
    if (!uid) continue;
    if (!candidateIds.has(uid)) continue;
    if (seenRowKeys.has(row.rowKey)) continue;
    seenRowKeys.add(row.rowKey);
    usersWithAdapterRow.add(uid);
    if (args.takenRowKeys.has(row.rowKey)) {
      alreadyLinkedCount += 1;
      continue;
    }
    rowsToCreate.push(row);
  }

  // Pass 2: synthetic fanout-row для users у которых адаптер row не дал.
  for (const uid of candidateIds) {
    if (usersWithAdapterRow.has(uid)) continue;
    const syntheticKey = `fanout:${args.journalCode}:${uid}`;
    if (args.takenRowKeys.has(syntheticKey)) {
      alreadyLinkedCount += 1;
      continue;
    }
    rowsToCreate.push({
      rowKey: syntheticKey,
      label: args.fanOutLabel ?? args.journalCode,
      responsibleUserId: uid,
    });
  }

  if (rowsToCreate.length === 0) {
    return { rows: [], alreadyLinked: alreadyLinkedCount };
  }
  return { rows: rowsToCreate, alreadyLinked: alreadyLinkedCount };
}
