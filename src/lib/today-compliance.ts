import { db } from "@/lib/db";
import { buildingWhere } from "@/lib/building-scope";
import { getActiveCloseEvent } from "@/lib/journal-close-events";
import {
  DAILY_JOURNAL_CODES,
  CONFIG_DAILY_CODES,
} from "@/lib/daily-journal-codes";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { orgTodayKey } from "@/lib/timezone";
import {
  loadStaffScheduleMap,
  staffScheduleKey,
} from "@/lib/staff-journal-autofill";

export { DAILY_JOURNAL_CODES, CONFIG_DAILY_CODES };

/**
 * TasksFlow-driven readiness for a journal: when the org has TF tasks
 * tied to active documents covering today, the journal is «готов» iff
 * every such task is completed today. This overrides the entry-count
 * heuristics (which can lag behind reality when the TF assignment plan
 * doesn't perfectly match the document's roster — e.g. cold-equipment
 * fan-out where 3 cooks share 10 fridges, or hygiene where TF skips
 * employees without phone numbers).
 *
 * Rule per template:
 *   - If TF link count for today > 0:
 *       filled = (every link is completed AND completedAt ≥ todayStart)
 *     This OVERRIDES whatever entry-counting decided.
 *   - If TF link count for today === 0:
 *       no TF override; the caller's existing logic stands.
 *
 * "completedAt ≥ todayStart" rules out stale completions left over from
 * yesterday on a recurring task that TF rolled but our sync hasn't
 * polled yet.
 */
type TfTemplateReadiness = {
  totalCount: number;
  doneTodayCount: number;
  allDoneToday: boolean;
};

export async function getTasksFlowReadinessByTemplate(
  organizationId: string,
  todayStart: Date,
  activeDocs: Array<{ id: string; templateId: string }>
): Promise<Map<string, TfTemplateReadiness>> {
  const out = new Map<string, TfTemplateReadiness>();
  if (activeDocs.length === 0) return out;
  const docIds = activeDocs.map((d) => d.id);
  const templateByDocId = new Map<string, string>();
  for (const doc of activeDocs) templateByDocId.set(doc.id, doc.templateId);

  const links = await db.tasksFlowTaskLink.findMany({
    where: {
      journalDocumentId: { in: docIds },
      integration: { organizationId, enabled: true },
    },
    select: {
      journalDocumentId: true,
      remoteStatus: true,
      completedAt: true,
    },
  });

  for (const link of links) {
    const templateId = templateByDocId.get(link.journalDocumentId);
    if (!templateId) continue;
    const acc = out.get(templateId) ?? {
      totalCount: 0,
      doneTodayCount: 0,
      allDoneToday: false,
    };
    acc.totalCount += 1;
    const doneToday =
      link.remoteStatus === "completed" &&
      link.completedAt !== null &&
      link.completedAt >= todayStart;
    if (doneToday) acc.doneTodayCount += 1;
    out.set(templateId, acc);
  }

  for (const acc of out.values()) {
    acc.allDoneToday = acc.totalCount > 0 && acc.doneTodayCount === acc.totalCount;
  }

  return out;
}

/**
 * "Filled today" check for a journal template. Not every mandatory
 * journal has daily obligations — some are aperiodic (accidents,
 * complaints, breakdowns happen only when they happen) or event-driven
 * (incoming raw material inspection, intensive cooling, metal-impurity
 * checks, audits, staff training, equipment calibration…). Flagging
 * those as «не заполнено сегодня» every day would be wrong.
 *
 * So we classify templates by cadence:
 *
 *   - DAILY_JOURNAL_CODES — have to be filled every working day
 *     (hygiene, health_check, temperatures, cleaning, fryer, etc.)
 *   - everything else — aperiodic, counts as «always filled» from
 *     the compliance-ring perspective.
 *
 * For daily journals we compare today's rows against the document's
 * natural roster size (max rows observed on any single day within the
 * 30-day lookback window):
 *
 *   todayCount   = # of `JournalDocumentEntry` rows with `date = today`
 *   expectedCount = max # of rows seen on any single prior day within
 *                   the last 30 days (hygiene → # of employees,
 *                   cold-equipment → # of fridges, cleaning → # of
 *                   procedures, etc.)
 *   documentFilled = expectedCount === 0
 *                      ? todayCount > 0       // brand-new doc, any row counts
 *                      : todayCount >= expectedCount
 *
 * The template is considered filled today iff there's at least one
 * active document that covers today AND every such document is filled.
 *
 * Legacy `JournalEntry` journals (form-based, no per-day grid concept)
 * stay on the simpler "at least one entry today" rule.
 */


type DayRollup = {
  date: Date;
  count: number;
};

type DocumentRollup = {
  todayCount: number;
  expectedCount: number;
  filled: boolean;
};

/**
 * Начало «сегодня» для сравнения с `JournalDocumentEntry.date`.
 *
 * Записи хранятся UTC-полночью того дня, который человек выбрал в своём
 * календаре (см. /api/journal-documents/[id]/entries — `new Date("YYYY-MM-DD")`
 * парсится как UTC-полночь). Поэтому и «сегодня» надо брать в зоне
 * организации, а не в зоне процесса: на проде процесс живёт в UTC, и с
 * 00:00 до 03:00 МСК `now` по UTC — это ещё ВЧЕРА. Повар, заполнивший
 * журнал в час ночи, видел красную карточку: его запись легла в 29-е,
 * а статус искал 28-е. Та же причина уже описана в `orgTodayKey`
 * (src/lib/timezone.ts) — здесь просто не была учтена.
 *
 * `now`, пришедший РОВНО UTC-полночью, — это не «сейчас», а явно
 * названный день: так его передают отчёт за период и сертификат, которые
 * идут по датам в цикле. Такой вход берём как есть, иначе в зоне с
 * отрицательным смещением день уехал бы на сутки назад.
 *
 * Решение вынесено в чистую `resolveDayStart` — её проверяет
 * `today-compliance.test.ts` без похода в БД.
 */
export function resolveDayStart(timezone: string | null, now: Date): Date {
  const isExplicitDay =
    now.getUTCHours() === 0 &&
    now.getUTCMinutes() === 0 &&
    now.getUTCSeconds() === 0 &&
    now.getUTCMilliseconds() === 0;
  if (isExplicitDay) return now;

  return new Date(`${orgTodayKey(timezone || undefined, now)}T00:00:00.000Z`);
}

/**
 * Кто сегодня не работает: выходной по `User.weeklyDaysOff`, отпуск
 * (`StaffVacation`) или больничный (`StaffSickLeave`). Источник тот же,
 * что у автозаполнения кадровых журналов.
 */
async function loadOffDutyToday(
  organizationId: string,
  employeeIds: string[],
  todayKey: string
): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const schedule = await loadStaffScheduleMap(db, {
    employeeIds,
    dateKeys: [todayKey],
    organizationId,
  });
  const off = new Set<string>();
  for (const employeeId of employeeIds) {
    if (schedule.get(staffScheduleKey(employeeId, todayKey))) {
      off.add(employeeId);
    }
  }
  return off;
}

async function orgDayStart(organizationId: string, now: Date): Promise<Date> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return resolveDayStart(org?.timezone ?? null, now);
}

async function rollupDocumentForDay(
  documentId: string,
  todayStart: Date,
  todayEnd: Date,
  /**
   * Организация документа и его код — нужны кадровым журналам
   * (гигиена, здоровье), чтобы не требовать отметку от тех, у кого
   * сегодня выходной, отпуск или больничный.
   */
  staffSchedule?: { organizationId: string; templateCode: string }
): Promise<DocumentRollup> {
  const lookbackStart = new Date(todayStart);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 30);

  const entries = await db.journalDocumentEntry.findMany({
    where: {
      documentId,
      date: { gte: lookbackStart, lt: todayEnd },
      ...NOT_AUTO_SEEDED,
    },
    select: { date: true, employeeId: true },
  });

  if (
    staffSchedule &&
    STAFF_SCHEDULE_CODES.has(staffSchedule.templateCode)
  ) {
    const todayKey = todayStart.toISOString().slice(0, 10);
    const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
    const offToday = await loadOffDutyToday(
      staffSchedule.organizationId,
      employeeIds,
      todayKey
    );
    return rollupStaffJournalDay({
      entries: entries.map((entry) => ({
        dayKey: entry.date.toISOString().slice(0, 10),
        employeeId: entry.employeeId,
      })),
      todayKey,
      offTodayEmployeeIds: offToday,
    });
  }

  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const dayKey = entry.date.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + 1);
  }

  const todayKey = todayStart.toISOString().slice(0, 10);
  const todayCount = byDay.get(todayKey) ?? 0;

  // Use the most-recent prior day with any entries as the "expected"
  // roster size. This reflects the current roster (e.g. if an employee
  // was removed yesterday, expected drops right away) while skipping
  // weekend gaps and empty days. Max-over-30-days was too rigid — one
  // unusually-large prior day would keep today "not filled" forever.
  const priorDayKeys = [...byDay.keys()]
    .filter((dayKey) => dayKey !== todayKey)
    .sort();
  let expectedCount = 0;
  for (let i = priorDayKeys.length - 1; i >= 0; i--) {
    const count = byDay.get(priorDayKeys[i]) ?? 0;
    if (count > 0) {
      expectedCount = count;
      break;
    }
  }

  // No history → one entry is enough (first day of a brand-new document).
  if (expectedCount === 0) {
    return { todayCount, expectedCount: 0, filled: todayCount > 0 };
  }

  return {
    todayCount,
    expectedCount,
    filled: todayCount >= expectedCount,
  };
}

/**
 * Journals we still judge by «все ли из ростера сделали запись» — где
 * журнал реально ведётся по КАЖДОМУ сотруднику ежедневно, и любая
 * пропущенная строка — это явный баг (hygiene, health_check).
 *
 * Все остальные daily-журналы оцениваются проще: «был ли хоть один
 * штрих за сегодня» → зелёный. Причина — для замеров холодильников,
 * уборки, фритюра и т.п. менеджер не всегда знает финальное число
 * записей (например сколько раз за смену проверят фритюр). Пустое
 * сегодня = «не начали», любая запись = «пошло».
 */
const STRICT_COMPLETENESS_CODES = new Set(["hygiene", "health_check"]);

/**
 * Журналы, где строка заводится на каждого сотрудника, а сотрудник в
 * выходной / отпуске / на больничном её не заполняет. Строгая проверка
 * «все отметились сегодня» обязана таких людей пропускать — иначе при
 * выходных Сб-Вс счётчик красный всю субботу и воскресенье.
 */
const STAFF_SCHEDULE_CODES = new Set(["hygiene", "health_check"]);

/**
 * Строгая проверка дня по записям документа: «отметились все, кто
 * сегодня работает». Чистая функция — её проверяют тесты без БД.
 *
 * Ожидаемое число берём как раньше: ростер последнего дня, в котором
 * вообще были записи, — но вычитаем тех, у кого сегодня нерабочий день.
 */
export function rollupStaffJournalDay(params: {
  entries: { dayKey: string; employeeId: string }[];
  todayKey: string;
  offTodayEmployeeIds: ReadonlySet<string>;
}): DocumentRollup {
  const { todayKey, offTodayEmployeeIds } = params;
  const onDuty = (employeeId: string) => !offTodayEmployeeIds.has(employeeId);

  const byDay = new Map<string, Set<string>>();
  for (const entry of params.entries) {
    const day = byDay.get(entry.dayKey) ?? new Set<string>();
    day.add(entry.employeeId);
    byDay.set(entry.dayKey, day);
  }

  const todayIds = [...(byDay.get(todayKey) ?? new Set<string>())].filter(onDuty);
  const todayCount = todayIds.length;

  const priorDayKeys = [...byDay.keys()].filter((key) => key !== todayKey).sort();
  let rosterIds: string[] = [];
  for (let i = priorDayKeys.length - 1; i >= 0; i -= 1) {
    const ids = byDay.get(priorDayKeys[i]);
    if (ids && ids.size > 0) {
      rosterIds = [...ids];
      break;
    }
  }

  // Истории нет — первый день документа: достаточно одной записи.
  if (rosterIds.length === 0) {
    return { todayCount, expectedCount: 0, filled: todayCount > 0 };
  }

  const expectedCount = rosterIds.filter(onDuty).length;
  // Сегодня не работает вообще никто (все в выходном/отпуске) — день
  // закрыт, красным его показывать не за что.
  if (expectedCount === 0) {
    return { todayCount, expectedCount: 0, filled: true };
  }

  return { todayCount, expectedCount, filled: todayCount >= expectedCount };
}


/**
 * Per-template-code rollup for journals that store rows inside
 * `JournalDocument.config` instead of `JournalDocumentEntry`. Returns
 * null if the template isn't recognized — callers then fall back to
 * the entry-based rollup or treat the template as aperiodic.
 */
export function rollupConfigDocumentForDay(
  templateCode: string,
  config: unknown,
  todayKey: string
): DocumentRollup | null {
  if (!config || typeof config !== "object") return null;
  const cfg = config as Record<string, unknown>;

  if (templateCode === "cleaning") {
    // matrix[roomId][dateKey] — one mark per room per day. Expected
    // count = # of rooms; todayCount = rooms with a non-empty mark
    // for today. Skip-weekends documents only count weekdays; here
    // we just check "has any value" because the room list is finite.
    const matrix =
      cfg.matrix && typeof cfg.matrix === "object"
        ? (cfg.matrix as Record<string, Record<string, unknown>>)
        : {};
    // Room-first документы (cleaningMode "rooms") держат список помещений
    // в `selectedRoomIds`, а `rooms` у них пустой — без этого такой
    // журнал никогда не становился «заполнен сегодня».
    const roomIds = new Set<string>();
    for (const room of Array.isArray(cfg.rooms) ? cfg.rooms : []) {
      const roomId = (room as { id?: string })?.id;
      if (roomId) roomIds.add(roomId);
    }
    if (cfg.cleaningMode === "rooms" && Array.isArray(cfg.selectedRoomIds)) {
      for (const id of cfg.selectedRoomIds) {
        if (typeof id === "string" && id) roomIds.add(id);
      }
    }
    let todayCount = 0;
    for (const roomId of roomIds) {
      const cell = matrix[roomId]?.[todayKey];
      if (cell !== undefined && cell !== "" && cell !== null) {
        todayCount += 1;
      }
    }
    const expectedCount = roomIds.size;
    if (expectedCount === 0) {
      return { todayCount, expectedCount: 0, filled: todayCount > 0 };
    }
    return {
      todayCount,
      expectedCount,
      filled: todayCount >= expectedCount,
    };
  }

  if (templateCode === "finished_product" || templateCode === "perishable_rejection") {
    // Each row is an aperiodic event inspection (a batch, a delivery).
    // No fixed roster — we can only say "has any row for today".
    const rows = Array.isArray(cfg.rows) ? cfg.rows : [];
    const dateField =
      templateCode === "finished_product" ? "productionDateTime" : "arrivalDate";
    let todayCount = 0;
    for (const row of rows) {
      const raw = (row as Record<string, unknown>)[dateField];
      if (typeof raw !== "string") continue;
      if (raw.slice(0, 10) === todayKey) todayCount += 1;
    }
    return {
      todayCount,
      expectedCount: todayCount > 0 ? todayCount : 1,
      filled: todayCount > 0,
    };
  }

  return null;
}

/**
 * Returns the set of JournalTemplate IDs considered "filled today"
 * (organization-scoped). Aperiodic journals (not in
 * `DAILY_JOURNAL_CODES` and not in `CONFIG_DAILY_CODES`) are always
 * treated as filled and returned whenever the caller provides their
 * template codes via `allTemplates`. Daily journals have their
 * filled-ness computed from either `JournalDocumentEntry` rows
 * (DAILY_JOURNAL_CODES) or inline config rows (CONFIG_DAILY_CODES)
 * — see module-level docstring for the exact rules.
 */
export type TemplatesFilledTodayOptions = {
  treatAperiodicAsFilled?: boolean;
  /** Точка: считать только её документы (и общие без точки). null — все. */
  buildingId?: string | null;
};

export async function getTemplatesFilledToday(
  organizationId: string,
  now: Date = new Date(),
  allTemplates?: Array<{ id: string; code: string }>,
  disabledCodes?: Set<string>,
  options: TemplatesFilledTodayOptions = {}
): Promise<Set<string>> {
  const treatAperiodicAsFilled = options.treatAperiodicAsFilled ?? true;
  const todayStart = await orgDayStart(organizationId, now);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
  const lookbackStart = new Date(todayStart);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 30);

  const [legacyEntries, activeDocuments] = await Promise.all([
    db.journalEntry.findMany({
      where: {
        organizationId,
        createdAt: { gte: todayStart, lt: todayEnd },
      },
      select: { templateId: true },
      distinct: ["templateId"],
    }),
    db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        dateFrom: { lte: todayStart },
        dateTo: { gte: todayStart },
        ...buildingWhere(options.buildingId),
      },
      select: {
        id: true,
        templateId: true,
        config: true,
        template: { select: { code: true } },
      },
    }),
  ]);

  const filled = new Set<string>();
  for (const entry of legacyEntries) filled.add(entry.templateId);

  // Только aperiodic-журналы, у которых есть хотя бы один активный
  // документ на сегодня, считаются «готовыми по умолчанию». До этого
  // было «все aperiodic автоматически filled» — что приводило к
  // 71% готовности у свежезарегистрированной компании с нулевым
  // настройкой: 25 из 35 журналов — aperiodic, они все зеленые,
  // менеджер думает «что-то уже сделано», хотя ещё ничего не
  // настроено. Теперь журнал идёт в числитель ring'a только когда
  // менеджер реально его ведёт (документ активен).
  const activeByTemplate = new Map<string, number>();
  for (const doc of activeDocuments) {
    activeByTemplate.set(
      doc.templateId,
      (activeByTemplate.get(doc.templateId) ?? 0) + 1
    );
  }

  if (allTemplates && treatAperiodicAsFilled) {
    for (const tpl of allTemplates) {
      if (disabledCodes?.has(tpl.code)) {
        filled.add(tpl.id);
        continue;
      }
      const isAperiodic =
        !DAILY_JOURNAL_CODES.has(tpl.code) &&
        !CONFIG_DAILY_CODES.has(tpl.code);
      if (isAperiodic && (activeByTemplate.get(tpl.id) ?? 0) > 0) {
        filled.add(tpl.id);
      }
    }
  }

  const todayKey = todayStart.toISOString().slice(0, 10);
  const eligibleTemplateCodes = allTemplates
    ? new Set(
        allTemplates
          .filter((tpl) => !disabledCodes?.has(tpl.code))
          .map((tpl) => tpl.code)
      )
    : null;
  const isEligibleDocument = (doc: (typeof activeDocuments)[number]) =>
    !eligibleTemplateCodes || eligibleTemplateCodes.has(doc.template.code);

  // Config-stored daily journals (cleaning / finished_product /
  // perishable_rejection). «Начат сегодня» = хотя бы одна строка с
  // datom = today в config.rows[] / matrix. Это relaxed-режим —
  // менеджер просто хочет видеть зелёный, когда сотрудник уже
  // сделал первую запись.
  const configDocs = activeDocuments.filter(
    (doc) => isEligibleDocument(doc) && CONFIG_DAILY_CODES.has(doc.template.code)
  );
  const configDocsByTemplate = new Map<string, boolean[]>();
  for (const doc of configDocs) {
    const rollup = rollupConfigDocumentForDay(
      doc.template.code,
      doc.config,
      todayKey
    );
    const started = (rollup?.todayCount ?? 0) > 0;
    const list = configDocsByTemplate.get(doc.templateId) ?? [];
    list.push(started);
    configDocsByTemplate.set(doc.templateId, list);
  }
  // Для config-журналов: «хотя бы один активный doc начат» = filled.
  // Раньше требовалось every() — но это противоречит spirit-y
  // «начали заполнять», когда в организации несколько параллельных
  // документов по одному журналу.
  for (const [templateId, results] of configDocsByTemplate.entries()) {
    if (results.some((ok) => ok)) {
      filled.add(templateId);
    }
  }

  const dailyDocs = activeDocuments.filter(
    (doc) =>
      isEligibleDocument(doc) &&
      (DAILY_JOURNAL_CODES.has(doc.template.code) ||
        (!treatAperiodicAsFilled && !CONFIG_DAILY_CODES.has(doc.template.code)))
  );
  if (dailyDocs.length === 0) return filled;

  // Single grouped query — pulls 30-day rollup counts once for all
  // daily docs. We derive two things out of the same dataset:
  //   - «хоть одна запись за сегодня» (для relaxed-журналов)
  //   - «сегодняшних ≥ предыдущего рабочего дня» (для STRICT журналов
  //     типа hygiene / health_check, где правило прежнее — каждый
  //     сотрудник должен отметиться).
  const dailyDocIds = dailyDocs.map((d) => d.id);
  const rollupRows = await db.journalDocumentEntry.groupBy({
    by: ["documentId", "date"],
    where: {
      documentId: { in: dailyDocIds },
      date: { gte: lookbackStart, lt: todayEnd },
      // Исключаем авто-сид'ы (созданные при пересоздании документа,
      // когда у пользователя ещё ноль фактических заполнений).
      // См. journal-document-entries-seed.ts. Без этого баннер
      // «Сегодня журнал уже заполнялся» показывается на пустом доке.
      ...NOT_AUTO_SEEDED,
    },
    _count: { _all: true },
  });
  const byDocument = new Map<string, Map<string, number>>();
  for (const row of rollupRows) {
    const dayKey = row.date.toISOString().slice(0, 10);
    let docMap = byDocument.get(row.documentId);
    if (!docMap) {
      docMap = new Map();
      byDocument.set(row.documentId, docMap);
    }
    docMap.set(dayKey, row._count._all);
  }

  // Кадровые журналы: строки по сотрудникам, и тот, у кого сегодня
  // выходной/отпуск/больничный, отметку не ставит. Поэтому по ним
  // берём записи с employeeId и считаем только работающих сегодня.
  const staffDocIds = dailyDocs
    .filter((doc) => STAFF_SCHEDULE_CODES.has(doc.template.code))
    .map((doc) => doc.id);
  const staffEntries =
    staffDocIds.length > 0
      ? await db.journalDocumentEntry.findMany({
          where: {
            documentId: { in: staffDocIds },
            date: { gte: lookbackStart, lt: todayEnd },
            ...NOT_AUTO_SEEDED,
          },
          select: { documentId: true, date: true, employeeId: true },
        })
      : [];
  const staffEntriesByDocument = new Map<
    string,
    { dayKey: string; employeeId: string }[]
  >();
  for (const entry of staffEntries) {
    const list = staffEntriesByDocument.get(entry.documentId) ?? [];
    list.push({
      dayKey: entry.date.toISOString().slice(0, 10),
      employeeId: entry.employeeId,
    });
    staffEntriesByDocument.set(entry.documentId, list);
  }
  const offDutyToday = await loadOffDutyToday(
    organizationId,
    [...new Set(staffEntries.map((entry) => entry.employeeId))],
    todayKey
  );

  function documentStartedToday(documentId: string): boolean {
    const byDay = byDocument.get(documentId) ?? new Map();
    return (byDay.get(todayKey) ?? 0) > 0;
  }
  function documentFilledStrict(documentId: string): boolean {
    const staffRows = staffEntriesByDocument.get(documentId);
    if (staffRows) {
      return rollupStaffJournalDay({
        entries: staffRows,
        todayKey,
        offTodayEmployeeIds: offDutyToday,
      }).filled;
    }
    const byDay = byDocument.get(documentId) ?? new Map();
    const todayCount = byDay.get(todayKey) ?? 0;
    if (todayCount === 0) return false;
    const priorDayKeys = [...byDay.keys()]
      .filter((k) => k !== todayKey)
      .sort();
    for (let i = priorDayKeys.length - 1; i >= 0; i--) {
      const count = byDay.get(priorDayKeys[i]) ?? 0;
      if (count > 0) return todayCount >= count;
    }
    return true;
  }

  const documentsByTemplate = new Map<string, { code: string; docIds: string[] }>();
  for (const doc of dailyDocs) {
    const entry = documentsByTemplate.get(doc.templateId) ?? {
      code: doc.template.code,
      docIds: [],
    };
    entry.docIds.push(doc.id);
    documentsByTemplate.set(doc.templateId, entry);
  }

  // Strict-режим включается legacy-кодами или динамически когда
  // менеджер выбрал fillMode="per-employee". Грузим fillMode для всех
  // активных шаблонов одним запросом — лишний select без N+1.
  const templateIdsInPlay = [...documentsByTemplate.keys()];
  const templateFillModes =
    templateIdsInPlay.length > 0
      ? await db.journalTemplate.findMany({
          where: { id: { in: templateIdsInPlay } },
          select: { id: true, fillMode: true },
        })
      : [];
  const fillModeById = new Map(
    templateFillModes.map((t) => [t.id, t.fillMode])
  );

  for (const [templateId, { code, docIds }] of documentsByTemplate.entries()) {
    const fillMode = fillModeById.get(templateId) ?? "per-employee";
    const strict =
      STRICT_COMPLETENESS_CODES.has(code) || fillMode === "per-employee";
    const ok = strict
      ? docIds.every(documentFilledStrict) // все документы целиком заполнены
      : docIds.some(documentStartedToday); // хотя бы один начат
    if (ok) filled.add(templateId);
  }

  // TasksFlow strict rule: если в орге включена TF-интеграция — журнал
  // считается заполненным сегодня ТОЛЬКО когда все TF-задачи на сегодня
  // отправлены И закрыты. Любая ручная запись в /journals без TF-цикла
  // НЕ делает журнал «зелёным» — пользователь явно попросил такое
  // поведение, чтобы дашборд отражал реальный путь «отправили → сделали»
  // (см. UX rules в CLAUDE.md: «pipeline-шаги вместо свободного
  // заполнения»). Если интеграция выключена — fallback на старые
  // entry-count эвристики выше.
  const orgHasTfIntegration = await db.tasksFlowIntegration.count({
    where: { organizationId, enabled: true },
  });
  const tfReadiness = await getTasksFlowReadinessByTemplate(
    organizationId,
    todayStart,
    activeDocuments.map((d) => ({ id: d.id, templateId: d.templateId }))
  );
  if (orgHasTfIntegration > 0) {
    // Применяем правило ко ВСЕМ daily-журналам с активным документом
    // на сегодня. Aperiodic не трогаем (они filled by default через
    // ветку выше). Если на журнал TF-задач нет совсем — стрипаем.
    // Если есть — verdict = readiness.allDoneToday.
    const dailyTemplateIdsWithActiveDoc = new Set<string>();
    for (const doc of activeDocuments) {
      const code = doc.template.code;
      if (DAILY_JOURNAL_CODES.has(code) || CONFIG_DAILY_CODES.has(code)) {
        dailyTemplateIdsWithActiveDoc.add(doc.templateId);
      }
    }
    for (const templateId of dailyTemplateIdsWithActiveDoc) {
      const readiness = tfReadiness.get(templateId);
      if (!readiness || readiness.totalCount === 0) {
        // Нет TF-задач на сегодня → не считается заполненным.
        filled.delete(templateId);
      } else if (readiness.allDoneToday) {
        filled.add(templateId);
      } else {
        filled.delete(templateId);
      }
    }
  } else {
    // Legacy: старый override — TF используется только если задачи есть.
    for (const [templateId, readiness] of tfReadiness.entries()) {
      if (readiness.totalCount === 0) continue;
      if (readiness.allDoneToday) {
        filled.add(templateId);
      } else {
        filled.delete(templateId);
      }
    }
  }

  // JournalCloseEvent override: если на сегодня есть active-closure
  // (kind = "no-events" | "closed-with-events" | "auto-closed-empty"),
  // журнал считается заполненным (compliance ✅). Это обеспечивает
  // что «Не требуется сегодня» / «Завершить смену» / даже cron
  // auto-close не оставляют красные журналы на дашборде.
  const todayCloseEvents = await db.journalCloseEvent.findMany({
    where: {
      organizationId,
      date: todayStart,
      reopenedAt: null, // активные closures (не reopened)
    },
    select: { templateId: true, kind: true },
  });
  for (const ce of todayCloseEvents) {
    filled.add(ce.templateId);
  }

  return filled;
}

/**
 * Single-template check. Same semantics as `getTemplatesFilledToday`.
 * Returns `true` for aperiodic templates (identified by `templateCode`)
 * without hitting the database beyond the legacy-entry lookup.
 */
export async function isTemplateFilledToday(
  organizationId: string,
  templateId: string,
  templateCode: string | null = null,
  now: Date = new Date()
): Promise<boolean> {
  const summary = await getTemplateTodaySummary(
    organizationId,
    templateId,
    templateCode,
    now
  );
  return summary.filled;
}

export type TemplateTodaySummary = {
  filled: boolean;
  /** True when the template has no daily obligation. UI may want to hide
   * progress bars in that case. */
  aperiodic: boolean;
  /** Sum of `JournalDocumentEntry` rows across all active documents for
   * today (across the template). 0 when only legacy entries exist. */
  todayCount: number;
  /** Sum of expected rows across all active documents for today. 0 when
   * the template has no documents (or all are brand-new without history). */
  expectedCount: number;
  /** True when there isn't a single active `JournalDocument` covering
   * today — the user has nothing to fill into and needs to create one. */
  noActiveDocument: boolean;
  /** ID of the first active `JournalDocument` covering today, if any.
   * Powers the «Перейти к документу» shortcut on the banner. */
  activeDocumentId: string | null;
};

export type TemplateTodaySummaryOptions = {
  treatAperiodicAsFilled?: boolean;
  /** Точка: только её документы (и общие без точки). null — все. */
  buildingId?: string | null;
};

/**
 * Detailed per-template summary for today. Powers the per-journal banner
 * — the banner uses `todayCount`/`expectedCount` to render «X из Y
 * строк за сегодня заполнено».
 */
export async function getTemplateTodaySummary(
  organizationId: string,
  templateId: string,
  templateCode: string | null = null,
  now: Date = new Date(),
  options: TemplateTodaySummaryOptions = {}
): Promise<TemplateTodaySummary> {
  const treatAperiodicAsFilled = options.treatAperiodicAsFilled ?? true;
  const todayStart = await orgDayStart(organizationId, now);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  // Aperiodic journals are treated as filled — no daily obligation.
  if (
    treatAperiodicAsFilled &&
    templateCode &&
    !DAILY_JOURNAL_CODES.has(templateCode) &&
    !CONFIG_DAILY_CODES.has(templateCode)
  ) {
    return {
      filled: true,
      aperiodic: true,
      todayCount: 0,
      expectedCount: 0,
      noActiveDocument: false,
      activeDocumentId: null,
    };
  }

  const [legacyCount, activeDocuments, template] = await Promise.all([
    db.journalEntry.count({
      where: {
        organizationId,
        templateId,
        createdAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId,
        templateId,
        status: "active",
        dateFrom: { lte: todayStart },
        dateTo: { gte: todayStart },
        ...buildingWhere(options.buildingId),
      },
      select: { id: true, config: true },
      orderBy: { dateFrom: "desc" },
    }),
    db.journalTemplate.findUnique({
      where: { id: templateId },
      select: { fillMode: true },
    }),
  ]);
  const fillMode = template?.fillMode ?? "per-employee";

  const activeDocumentId = activeDocuments[0]?.id ?? null;

  // JournalCloseEvent override: если на сегодня есть active closure —
  // журнал считается заполненным (зелёный), независимо от entry-count
  // и TF readiness. Это применяется к ЛЮБОМУ template'у, включая
  // aperiodic — менеджер может вручную закрыть «без событий».
  // Точки: своё закрытие точки или общее закрытие организации.
  const closeEvent = await getActiveCloseEvent(
    organizationId,
    templateId,
    todayStart,
    options.buildingId ?? null,
  );
  if (closeEvent) {
    return {
      filled: true,
      aperiodic: false,
      todayCount: 0,
      expectedCount: 0,
      noActiveDocument: false,
      activeDocumentId,
    };
  }

  // TasksFlow strict rule: если в орге включена TF-интеграция — для
  // daily-журнала с активным документом «filled» ТОЛЬКО когда все
  // TF-задачи отправлены и закрыты. Если задач нет совсем — журнал
  // явно не заполнен сегодня (юзер просил такое поведение, см.
  // комментарий в getTemplatesFilledToday).
  if (activeDocuments.length > 0) {
    const orgHasTfIntegration = await db.tasksFlowIntegration.count({
      where: { organizationId, enabled: true },
    });
    const tfReadiness = await getTasksFlowReadinessByTemplate(
      organizationId,
      todayStart,
      activeDocuments.map((d) => ({ id: d.id, templateId }))
    );
    const tf = tfReadiness.get(templateId);
    const isDaily =
      typeof templateCode === "string" &&
      (DAILY_JOURNAL_CODES.has(templateCode) ||
        CONFIG_DAILY_CODES.has(templateCode));
    if (orgHasTfIntegration > 0 && isDaily) {
      // Strict TF mode: задачи обязательно нужны.
      return {
        filled: tf?.allDoneToday === true,
        aperiodic: false,
        todayCount: tf?.doneTodayCount ?? 0,
        expectedCount: tf?.totalCount ?? 0,
        noActiveDocument: false,
        activeDocumentId,
      };
    }
    // Legacy: TF override применяется только если задачи существуют.
    if (tf && tf.totalCount > 0) {
      return {
        filled: tf.allDoneToday,
        aperiodic: false,
        todayCount: tf.doneTodayCount,
        expectedCount: tf.totalCount,
        noActiveDocument: false,
        activeDocumentId,
      };
    }
  }

  if (legacyCount > 0) {
    return {
      filled: true,
      aperiodic: false,
      todayCount: legacyCount,
      expectedCount: legacyCount,
      noActiveDocument: false,
      activeDocumentId,
    };
  }
  if (activeDocuments.length === 0) {
    return {
      filled: false,
      aperiodic: false,
      todayCount: 0,
      expectedCount: 0,
      noActiveDocument: true,
      activeDocumentId: null,
    };
  }

  // Config-stored journals — inspect the document config directly.
  if (templateCode && CONFIG_DAILY_CODES.has(templateCode)) {
    const todayKey = todayStart.toISOString().slice(0, 10);
    const configRollups = activeDocuments.map(
      (doc) =>
        rollupConfigDocumentForDay(templateCode, doc.config, todayKey) ?? {
          todayCount: 0,
          expectedCount: 0,
          filled: false,
        }
    );
    const todayCount = configRollups.reduce((sum, r) => sum + r.todayCount, 0);
    const expectedCount = configRollups.reduce(
      (sum, r) => sum + r.expectedCount,
      0
    );
    // Relaxed для config-based: «начали = зелёный». Никаких
    // config-based журналов в STRICT нет.
    const filled = todayCount > 0;
    return {
      filled,
      aperiodic: false,
      todayCount,
      expectedCount,
      noActiveDocument: false,
      activeDocumentId,
    };
  }

  // Strict-режим (журнал «выполнен» только когда все eligible
   // сотрудники отметились) включается двумя путями:
  //   1. Хардкод: hygiene/health_check (legacy + per-employee по
  //      дизайну с самого начала)
  //   2. Динамически: любой шаблон с `fillMode === "per-employee"` —
  //      т.е. менеджер настроил «каждый сотрудник заполняет за себя»
  //      в `/settings/journals`. Один заполнивший ≠ выполнен.
  const strict =
    (typeof templateCode === "string" &&
      STRICT_COMPLETENESS_CODES.has(templateCode)) ||
    fillMode === "per-employee";

  const rollups = await Promise.all(
    activeDocuments.map(async (doc) => {
      if (strict) {
        // hygiene / health_check продолжают пользоваться строгой
        // ростер-логикой — по каждому сотруднику за сегодня должна
        // быть запись. Для deep-inspect-ов эта ветка не нужна — они
        // все в relaxed-наборе.
        return rollupDocumentForDay(
          doc.id,
          todayStart,
          todayEnd,
          typeof templateCode === "string"
            ? { organizationId, templateCode }
            : undefined
        );
      }
      // Relaxed: «начали сегодня». Считаем только todayCount — без
      // сравнения с предыдущим днём, без inspect'ов equipment/room.
      // NOT_AUTO_SEEDED: иначе compliance ring показывает «заполнено»
      // на свежесозданном документе с одними seeded-плейсхолдерами.
      const today = await db.journalDocumentEntry.count({
        where: {
          documentId: doc.id,
          date: { gte: todayStart, lt: todayEnd },
          ...NOT_AUTO_SEEDED,
        },
      });
      return {
        todayCount: today,
        expectedCount: today > 0 ? today : 1,
        filled: today > 0,
      };
    })
  );

  const todayCount = rollups.reduce((sum, r) => sum + r.todayCount, 0);
  const expectedCount = rollups.reduce((sum, r) => sum + r.expectedCount, 0);
  const filled = strict
    ? rollups.every((r) => r.filled)
    : rollups.some((r) => r.filled);

  return {
    filled,
    aperiodic: false,
    todayCount,
    expectedCount,
    noActiveDocument: false,
    activeDocumentId,
  };
}

// Kept for future consumers (e.g. analytics) — intentionally unused now.
export type { DayRollup };
