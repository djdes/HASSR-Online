/**
 * Helper'ы для автосоздания документов журналов.
 *
 * Используется двумя точками входа:
 *   - POST /api/journal-documents/bulk-create — менеджер нажимает
 *     «Создать все выбранные» на /journals
 *   - POST /api/cron/auto-create-journals — дневной cron, создаёт
 *     документы по списку из Organization.autoJournalCodes
 *
 * Семантика: для каждого templateCode, не имеющего активного документа
 * с dateFrom ≤ today ≤ dateTo, создаём документ на ТЕКУЩИЙ месяц
 * (1-е → последнее число). Уже существующий активный документ не
 * трогаем — возвращаем существующий id, чтобы клиент мог отправить в
 * отчёте «уже был».
 */
import { buildingWhere } from "@/lib/building-scope";
import type { PrismaClient } from "@prisma/client";
import {
  parseJournalPeriodsJson,
  resolveJournalPeriod,
  resolveJournalPeriodKind,
  type JournalPeriodKind,
  type JournalPeriodOverrideMap,
} from "@/lib/journal-period";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { seedEntriesForDocument } from "@/lib/journal-document-entries-seed";
import {
  getPrimarySlotId,
  getVerifierSlotId,
} from "@/lib/journal-responsible-schemas";
import {
  getJournalAutomation,
  isPerEmployeeJournal,
  type JournalAutomationResponsibles,
} from "@/lib/journal-automation";
import { resolveAutomationStaff } from "@/lib/journal-automation-staff";
import { getUserPositionLabel } from "@/lib/user-roles";
import {
  applyRoomScheduleToMatrix,
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  fillPastDaysNotPerformed,
  normalizeCleaningDocumentConfig,
  stripPeriodSpecificCleaningFields,
  type CleaningDocumentConfig,
  type RoomScheduleFromDb,
  applyRoomsToCleaningConfig,
  toRoomScheduleMap,
} from "@/lib/cleaning-document";
import { buildDateKeys, toDateKey } from "@/lib/hygiene-document";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";

/**
 * Название автосозданного документа.
 *
 * ПОЧЕМУ: раньше здесь был свой формат «Имя журнала · Сентябрь с 1 по 15»,
 * а диалог «Создать документ» звал `buildDocumentAutoTitle` и давал
 * «Имя журнала — 1–15 сентября 2026». На один период выходило два бланка
 * с разными именами, и список читался как два разных журнала.
 */
function autoDocumentTitle(
  templateCode: string,
  journalName: string,
  period: { dateFrom: Date; dateTo: Date; label: string }
): string {
  const title = buildDocumentAutoTitle({
    templateCode,
    journalName,
    dateFrom: period.dateFrom.toISOString().slice(0, 10),
    dateTo: period.dateTo.toISOString().slice(0, 10),
  });
  // Пустое название невозможно (имя шаблона всегда есть), но страхуемся.
  return title || `${journalName} · ${period.label}`;
}

/**
 * Возвращает config самого свежего предыдущего JournalDocument
 * (org + template), очищенный от period-specific полей. Для cleaning
 * это matrix/marks; для других журналов пока — null (можем расширить).
 *
 * Используется чтобы новый период cleaning создавался «как прошлый»:
 * те же rooms, ответственные, weekday-маски. Без этого cron каждый
 * месяц генерил пустой документ из DEFAULT_ROOM_BLUEPRINTS, и менеджеру
 * приходилось заново настраивать комнаты.
 */
async function fetchPreviousDocConfigForReuse(
  db: PrismaClient,
  organizationId: string,
  templateCode: string,
  /** Точка: конфиг наследуется от документа той же точки (или общего). */
  buildingId: string | null = null,
): Promise<Record<string, unknown> | null> {
  if (templateCode !== CLEANING_DOCUMENT_TEMPLATE_CODE) return null;
  const prev = await db.journalDocument.findFirst({
    where: {
      organizationId,
      template: { code: templateCode },
      ...buildingWhere(buildingId),
    },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    select: { config: true },
  });
  return stripPeriodSpecificCleaningFields(prev?.config);
}

/**
 * C1/C2 аудита журналов: помещения уборки живут в таблице `Room`
 * (/settings/buildings), а НЕ в `config.rooms`. Раньше новый документ
 * сеялся четырьмя blueprint'ами («гостевая зона», «помещение мойки»,
 * «горячий цех/кухня», «Бар»), а клиент рисует ОБЪЕДИНЕНИЕ
 * `config.rooms ∪ Room` — отсюда дубли строк («Горячий цех/кухня» рядом
 * с реальным «Горячий цех»), пустой справочник scope и план, который
 * проставлялся blueprint'ам вместо настоящих помещений.
 *
 * Теперь: есть Room → `config.rooms = []`, `selectedRoomIds` = все Room
 * (или прошлый выбор, если он ещё валиден), режим `rooms`. Нет Room →
 * старое поведение с blueprint'ами (клиенту нечего показать иначе).
 */
type CleaningRoomFromDb = {
  id: string;
  currentDays: number;
  generalDays: number;
  currentScheduleType: string;
  generalScheduleType: string;
  currentMonthDays: unknown;
  generalMonthDays: unknown;
};

export async function fetchCleaningRooms(
  // Узкий Pick — движку автозаполнения (`journal-autofill.ts`) не нужен
  // весь PrismaClient, а полный тип не дал бы передать юнит-тестовый стаб.
  db: Pick<PrismaClient, "room">,
  organizationId: string,
  /** Точка: только помещения этого здания; null — все помещения организации. */
  buildingId: string | null = null,
): Promise<CleaningRoomFromDb[]> {
  return db.room.findMany({
    where: {
      building: { organizationId, ...(buildingId ? { id: buildingId } : {}) },
    },
    select: {
      id: true,
      currentDays: true,
      generalDays: true,
      currentScheduleType: true,
      generalScheduleType: true,
      currentMonthDays: true,
      generalMonthDays: true,
    },
    orderBy: [{ buildingId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * Cleaning-specific post-process: применяет weekday-маски помещений
 * (CleaningRoomItem.currentDays/generalDays) к matrix нового документа,
 * чтобы матрица была размечена «по плану» с самого создания.
 *
 * Затем прошедшие дни периода, оставшиеся без плановой отметки,
 * помечаются «/» («уборка не проводилась») — как на эталоне. Актуально
 * для догоняющего создания (документ создан не 1-го числа): дни с
 * начала периода до вчера не остаются пустыми.
 *
 * 2026-09-07: разметка идёт ТОЛЬКО ПО СЕГОДНЯ ВКЛЮЧИТЕЛЬНО. Раньше
 * план раскладывался на весь период, и свежесозданный журнал выглядел
 * заполненным на две недели вперёд («Т» до 15-го числа при сегодняшнем
 * 7-м) — для инспектора РПН это заполнение задним... вернее, передним
 * числом, а не график. Будущие дни доезжают сами:
 *   • ночной автозаполнитель (`applyJournalAutoFill`, dateKeys=[сегодня])
 *     каждый день кладёт в матрицу плановую отметку на этот день;
 *   • создание задач в TF пустую ячейку трактует как «уборка нужна»
 *     (`buildRoomsModeRows`), поэтому отсутствие плана вперёд ничего
 *     не ломает — пропускается только явное «/»;
 *   • менеджеру, которому нужен график на месяц, остаются кнопка
 *     «Заполнить по плану» и правка расписания помещения.
 *
 * Возвращает config как-есть для других журналов (no-op).
 */
/** Экспортируется ради регрессионного теста «план не уезжает в будущее». */
export function preplanCleaningConfig(
  templateCode: string,
  config: unknown,
  dateFrom: Date,
  dateTo: Date,
  now?: Date,
  /** C2: расписание Т/Г берём из Room, а не из config.rooms. */
  dbRooms?: Map<string, RoomScheduleFromDb>,
): unknown {
  if (templateCode !== CLEANING_DOCUMENT_TEMPLATE_CODE) return config;
  if (!config || typeof config !== "object") return config;
  const todayKey = toDateKey(now ?? new Date());
  const dateKeys = buildDateKeys(dateFrom, dateTo);
  const upToToday = dateKeys.filter((key) => key <= todayKey);
  // Нормализуем чтобы гарантировать структуру (rooms[], matrix etc.).
  const normalized = normalizeCleaningDocumentConfig(config) as CleaningDocumentConfig;
  const planned = applyRoomScheduleToMatrix(normalized, upToToday, "fill-empty", dbRooms);
  return fillPastDaysNotPerformed(planned, upToToday, { todayKey });
}

/**
 * Периоды, документы которых НЕ закрываем автоматически:
 *   • perpetual — open-ended журнал (дезсредства, чек-лист сан-дня),
 *     dateTo = 2099-12-31, он и не истекает;
 *   • yearly — медкнижки, график генеральных уборок и пр. Такие
 *     документы менеджер закрывает вручную, автозакрытие по календарю
 *     ломало бы работу с прошлогодними записями.
 */
const NON_CLOSING_PERIOD_KINDS = new Set<JournalPeriodKind>([
  "perpetual",
  "yearly",
]);

function isAutoClosablePeriod(
  templateCode: string,
  overrides: JournalPeriodOverrideMap
): boolean {
  const override = overrides[templateCode];
  const kind: JournalPeriodKind = override
    ? override.kind
    : resolveJournalPeriodKind(templateCode);
  return !NON_CLOSING_PERIOD_KINDS.has(kind);
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

async function loadPeriodOverrides(
  db: PrismaClient,
  organizationId: string
): Promise<JournalPeriodOverrideMap> {
  const orgRow = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalPeriods: true },
  });
  return parseJournalPeriodsJson(orgRow?.journalPeriods ?? null);
}

/**
 * Догоняющий шаг: закрывает active-документы организации, чей период
 * уже истёк (dateTo < сегодня) И у которых есть документ-преемник
 * (тот же шаблон, dateFrom > dateTo текущего). Без преемника документ
 * не трогаем — иначе журнал остался бы совсем без активного документа.
 *
 * Статус `closed` — тот же, что ставит кнопка «Отправить в закрытые»
 * (DocumentCloseButton), новых статусов не вводим. Идемпотентно:
 * повторный вызов не находит active-документов и ничего не делает.
 */
export async function closeExpiredDocuments(
  db: PrismaClient,
  args: {
    organizationId: string;
    /** Ограничить одним шаблоном (используется после look-ahead create). */
    templateId?: string;
    now?: Date;
    overrides?: JournalPeriodOverrideMap;
  }
): Promise<{ closed: number; documentIds: string[] }> {
  const todayUtcStart = startOfUtcDay(args.now ?? new Date());
  const expired = await db.journalDocument.findMany({
    where: {
      organizationId: args.organizationId,
      status: "active",
      dateTo: { lt: todayUtcStart },
      ...(args.templateId ? { templateId: args.templateId } : {}),
    },
    select: {
      id: true,
      templateId: true,
      buildingId: true,
      dateTo: true,
      template: { select: { code: true } },
    },
  });
  if (expired.length === 0) return { closed: 0, documentIds: [] };

  const overrides =
    args.overrides ?? (await loadPeriodOverrides(db, args.organizationId));
  const closedIds: string[] = [];

  for (const doc of expired) {
    const code = doc.template?.code;
    if (!code) continue;
    if (!isAutoClosablePeriod(code, overrides)) continue;

    const successor = await db.journalDocument.findFirst({
      where: {
        organizationId: args.organizationId,
        templateId: doc.templateId,
        dateFrom: { gt: doc.dateTo },
        id: { not: doc.id },
        // Точки: преемник — той же точки или общий; общий документ
        // закрывает любой преемник.
        ...buildingWhere(doc.buildingId),
      },
      select: { id: true },
    });
    if (!successor) continue;

    const res = await db.journalDocument.updateMany({
      where: { id: doc.id, status: "active" },
      data: { status: "closed" },
    });
    if (res.count > 0) closedIds.push(doc.id);
  }

  return { closed: closedIds.length, documentIds: closedIds };
}

/**
 * Ответственный и проверяющий из ПОСЛЕДНЕГО документа шаблона. Оба
 * проверяются на «всё ещё сотрудник этой организации и активен» —
 * иначе новый документ получил бы ссылку на уволенного.
 */
async function inheritResponsiblesFromLastDocument(
  db: PrismaClient,
  args: { organizationId: string; templateId: string; buildingId?: string | null }
): Promise<{ responsibleUserId: string | null; verifierUserId: string | null }> {
  const last = await db.journalDocument.findFirst({
    where: {
      organizationId: args.organizationId,
      templateId: args.templateId,
      ...buildingWhere(args.buildingId),
    },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    select: { responsibleUserId: true, verifierUserId: true },
  });
  if (!last) return { responsibleUserId: null, verifierUserId: null };

  const candidateIds = [last.responsibleUserId, last.verifierUserId].filter(
    (id): id is string => Boolean(id)
  );
  if (candidateIds.length === 0) {
    return { responsibleUserId: null, verifierUserId: null };
  }
  const alive = await db.user.findMany({
    where: {
      id: { in: candidateIds },
      organizationId: args.organizationId,
      isActive: true,
      // Архивный сотрудник — тот же уволенный: новый документ не должен
      // рождаться с ссылкой на него (раньше фильтра не было, и
      // наследование протаскивало архив).
      archivedAt: null,
      isRoot: false,
    },
    select: { id: true },
  });
  const aliveIds = new Set(alive.map((user) => user.id));
  return {
    responsibleUserId:
      last.responsibleUserId && aliveIds.has(last.responsibleUserId)
        ? last.responsibleUserId
        : null,
    verifierUserId:
      last.verifierUserId && aliveIds.has(last.verifierUserId)
        ? last.verifierUserId
        : null,
  };
}

/**
 * Кого автоматика хочет видеть ответственным и проверяющим в НОВОМ
 * документе — по политике `journalAutomationJson[code].responsibles`.
 *
 * Порядок разрешения (per-field, независимо):
 *   custom  → настроенный id, если он жив, активен и из этой организации;
 *   inherit → ответственные последнего документа шаблона;
 *   иначе   → null, и дальше работает штатный каскад слотов/keywords/
 *             ростера внутри `prefillResponsiblesForNewDocument`.
 *
 * Ошибок не бросает никогда: уволенный человек не должен мешать журналу
 * создаться, а политика остаётся в настройках и заработает снова, если
 * сотрудника восстановят.
 */
async function resolveDesiredResponsibles(
  db: PrismaClient,
  args: {
    organizationId: string;
    templateId: string;
    policy?: JournalAutomationResponsibles;
  }
): Promise<{ responsibleUserId: string | null; verifierUserId: string | null }> {
  const empty = { responsibleUserId: null, verifierUserId: null };
  if (!args.policy) return empty;

  if (args.policy.mode === "custom") {
    const wanted = [
      args.policy.responsibleUserId,
      args.policy.verifierUserId,
    ].filter((id): id is string => Boolean(id));
    const alive =
      wanted.length > 0
        ? await db.user.findMany({
            where: {
              id: { in: wanted },
              organizationId: args.organizationId,
              isActive: true,
              archivedAt: null,
              isRoot: false,
            },
            select: { id: true },
          })
        : [];
    const aliveIds = new Set(alive.map((user) => user.id));
    const custom = {
      responsibleUserId: aliveIds.has(args.policy.responsibleUserId)
        ? args.policy.responsibleUserId
        : null,
      verifierUserId:
        args.policy.verifierUserId && aliveIds.has(args.policy.verifierUserId)
          ? args.policy.verifierUserId
          : null,
    };
    if (custom.responsibleUserId && custom.verifierUserId) return custom;
    // Хоть один слот пуст — добираем наследованием, дальше сработает каскад.
    const inherited = await inheritResponsiblesFromLastDocument(db, args);
    return {
      responsibleUserId: custom.responsibleUserId ?? inherited.responsibleUserId,
      verifierUserId: custom.verifierUserId ?? inherited.verifierUserId,
    };
  }

  return inheritResponsiblesFromLastDocument(db, args);
}

/** Слот-карта для `prefillResponsiblesForNewDocument` (пустые не пишем). */
function buildSlotOverrides(
  templateCode: string,
  desired: { responsibleUserId: string | null; verifierUserId: string | null }
): Record<string, string | null> {
  const overrides: Record<string, string | null> = {};
  if (desired.responsibleUserId) {
    overrides[getPrimarySlotId(templateCode)] = desired.responsibleUserId;
  }
  if (desired.verifierUserId) {
    overrides[getVerifierSlotId(templateCode)] = desired.verifierUserId;
  }
  return overrides;
}

/**
 * Должность ответственного для колонки «Должность ответственного» и шапки
 * печатной формы. Без неё колонка автосозданных документов оставалась
 * пустой: `responsibleTitle` заполняли только ручное создание и каскад
 * настроек.
 */
async function loadResponsibleTitle(
  db: PrismaClient,
  organizationId: string,
  responsibleUserId: string | null
): Promise<string | null> {
  if (!responsibleUserId) return null;
  const user = await db.user.findFirst({
    where: { id: responsibleUserId, organizationId, ...ORG_ROSTER_WHERE },
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      jobPosition: { select: { name: true, categoryKey: true } },
    },
  });
  if (!user) return null;
  return getUserPositionLabel(user) || null;
}

/**
 * Список сотрудников-строк для per-employee журналов. Политика задана —
 * спрашиваем резолвер; нет — отдаём undefined, и сидер идёт легаси-путём.
 */
async function resolveSeedEmployeeIds(
  db: PrismaClient,
  args: {
    organizationId: string;
    templateCode: string;
    org: { journalAutomationJson?: unknown; autoJournalCodes?: unknown } | null;
  }
): Promise<string[] | undefined> {
  if (!isPerEmployeeJournal(args.templateCode)) return undefined;
  const staffPolicy = getJournalAutomation(args.org, args.templateCode).staff;
  if (!staffPolicy) return undefined;
  const resolved = await resolveAutomationStaff(db, {
    organizationId: args.organizationId,
    templateCode: args.templateCode,
    staffPolicy,
  });
  return resolved.employeeIds.length > 0 ? resolved.employeeIds : undefined;
}

export type CreateReport = {
  code: string;
  name: string;
  created: boolean;
  documentId: string;
  reason?: string;
};

export async function ensureActiveDocument(
  db: PrismaClient,
  args: {
    organizationId: string;
    templateCode: string;
    now?: Date;
    /**
     * Если у журнала нет назначенных в /settings/journal-responsibles
     * ответственных — взять их из ПОСЛЕДНЕГО документа этого шаблона.
     * Нужно догоняющему созданию по прерванной цепочке: там документ
     * рождается через год после предыдущего, и терять ответственных
     * предыдущего документа нельзя. Пользователь всё ещё должен
     * состоять в организации и быть активным.
     */
    inheritResponsiblesFromLastDocument?: boolean;
    /**
     * Значение `JournalDocument.autoFill` у создаваемого документа.
     * По умолчанию `false` — исторически автосоздание давало «пустой»
     * документ, а автозаполнение включалось тумблером вручную. Cron
     * автоматизации (`/api/cron/journal-automation`) передаёт `true`,
     * иначе созданный им документ никто не заполнит.
     */
    autoFill?: boolean;
    /**
     * Точка (2026-09-05): документ создаётся на эту точку. Guard «уже
     * есть активный» видит документы точки и общие (без точки): пока жив
     * общий документ периода, по точкам дублей не появляется.
     */
    buildingId?: string | null;
  }
): Promise<CreateReport> {
  const now = args.now ?? new Date();
  const template = await db.journalTemplate.findFirst({
    where: { code: args.templateCode, isActive: true },
    select: { id: true, name: true },
  });
  if (!template) {
    return {
      code: args.templateCode,
      name: args.templateCode,
      created: false,
      documentId: "",
      reason: "template-not-found",
    };
  }

  // Сравниваем с началом UTC-дня — иначе для monthly/half-monthly/
  // single-day/yearly документ создаётся с dateTo=00:00 UTC последнего
  // дня периода, а query `dateTo: { gte: now }` где now=10:00 UTC
  // возвращает false → каждый вызов плодит новый документ. (См.
  // тот же фикс в bulk-assign-today/route.ts от 2026-04-30.)
  const todayUtcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const existing = await db.journalDocument.findFirst({
    where: {
      organizationId: args.organizationId,
      templateId: template.id,
      status: "active",
      dateFrom: { lte: todayUtcStart },
      dateTo: { gte: todayUtcStart },
      ...buildingWhere(args.buildingId),
    },
    select: { id: true, title: true },
  });
  if (existing) {
    return {
      code: args.templateCode,
      name: template.name,
      created: false,
      documentId: existing.id,
      reason: "already-active",
    };
  }

  // Если у org есть per-template override периода (см.
  // /settings/journals — period column) — подмешиваем его в
  // resolveJournalPeriod. Иначе fallback на дефолтную семантику.
  const orgRow = await db.organization.findUnique({
    where: { id: args.organizationId },
    // Автоматика читается из той же строки: политика ответственных и
    // списка сотрудников живёт в journalAutomationJson, а легаси-список
    // автосоздания — в autoJournalCodes (нужен getJournalAutomation).
    select: {
      journalPeriods: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
    },
  });
  const overrides = parseJournalPeriodsJson(orgRow?.journalPeriods ?? null);
  const period = resolveJournalPeriod(args.templateCode, now, overrides);

  // Период уже СДАН. ПОЧЕМУ: раньше искали только активный документ, и
  // после «Отправить в закрытые» и кнопка «Закрыть день», и ночной крон,
  // и массовое создание заводили на тот же период ВТОРОЙ документ и
  // начинали его заполнять — в журнале оказывалось два бланка за один
  // месяц. Закрытый документ — решение человека: молча обходить его
  // новым бланком нельзя, поэтому пропускаем и называем причину.
  const closedSamePeriod = await db.journalDocument.findFirst({
    where: {
      organizationId: args.organizationId,
      templateId: template.id,
      status: "closed",
      // Пересечение отрезков: закрытый начался не позже конца нового и
      // закончился не раньше его начала.
      dateFrom: { lte: period.dateTo },
      dateTo: { gte: period.dateFrom },
      ...buildingWhere(args.buildingId),
    },
    select: { id: true },
    orderBy: { dateFrom: "desc" },
  });
  if (closedSamePeriod) {
    return {
      code: args.templateCode,
      name: template.name,
      created: false,
      documentId: closedSamePeriod.id,
      reason: "period-closed",
    };
  }

  const desired = await resolveDesiredResponsibles(db, {
    organizationId: args.organizationId,
    templateId: template.id,
    policy: getJournalAutomation(orgRow, args.templateCode).responsibles,
  });
  // «Как прошлый журнал» — для cleaning подтягиваем config предыдущего
  // документа (rooms, ответственные, weekday-маски), отрезая matrix/marks
  // (период-специфика). Так новый месяц cleaning стартует не с пустоты,
  // а с настроек прошлого месяца. Для других журналов prevConfig=null,
  // prefillResponsibles берёт getDefaultConfigForJournal.
  const prevConfig = await fetchPreviousDocConfigForReuse(
    db,
    args.organizationId,
    args.templateCode,
    args.buildingId ?? null,
  );
  // Подтягиваем сохранённых в /settings/journal-responsibles
  // ответственных в config + responsibleUserId.
  const prefill = await prefillResponsiblesForNewDocument({
    organizationId: args.organizationId,
    journalCode: args.templateCode,
    baseConfig: prevConfig ?? {},
    slotOverrides: buildSlotOverrides(args.templateCode, desired),
  });
  // C1: cleaning собирается от Room организации, а не от blueprint'ов.
  const cleaningRooms =
    args.templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? await fetchCleaningRooms(db, args.organizationId, args.buildingId ?? null)
      : [];
  const roomAwareConfig = applyRoomsToCleaningConfig(
    prefill.config,
    cleaningRooms.map((room) => room.id),
  );
  const planCfg = preplanCleaningConfig(
    args.templateCode,
    roomAwareConfig,
    period.dateFrom,
    period.dateTo,
    now,
    cleaningRooms.length > 0 ? toRoomScheduleMap(cleaningRooms) : undefined,
  );
  const inherited = args.inheritResponsiblesFromLastDocument
    ? await inheritResponsiblesFromLastDocument(db, {
        organizationId: args.organizationId,
        templateId: template.id,
        buildingId: args.buildingId ?? null,
      })
    : { responsibleUserId: null, verifierUserId: null };
  const responsibleUserId =
    prefill.responsibleUserId ?? inherited.responsibleUserId;
  const [responsibleTitle, seedEmployeeIds] = await Promise.all([
    loadResponsibleTitle(db, args.organizationId, responsibleUserId),
    resolveSeedEmployeeIds(db, {
      organizationId: args.organizationId,
      templateCode: args.templateCode,
      org: orgRow,
    }),
  ]);
  const doc = await db.journalDocument.create({
    data: {
      organizationId: args.organizationId,
      templateId: template.id,
      title: autoDocumentTitle(args.templateCode, template.name, period),
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      status: "active",
      autoFill: args.autoFill === true,
      buildingId: args.buildingId ?? null,
      config: planCfg as never,
      responsibleUserId,
      responsibleTitle,
      verifierUserId: prefill.verifierUserId ?? inherited.verifierUserId,
    },
    select: { id: true, dateFrom: true, dateTo: true },
  });
  await seedEntriesForDocument({
    documentId: doc.id,
    journalCode: args.templateCode,
    organizationId: args.organizationId,
    dateFrom: doc.dateFrom,
    dateTo: doc.dateTo,
    responsibleUserId,
    employeeIds: seedEmployeeIds,
  }).catch((err) => {
    console.warn(
      `[journal-auto-create] seedEntries failed for ${args.templateCode}`,
      err
    );
  });
  return {
    code: args.templateCode,
    name: template.name,
    created: true,
    documentId: doc.id,
  };
}

export async function ensureDocumentsFor(
  db: PrismaClient,
  args: {
    organizationId: string;
    templateCodes: string[];
    now?: Date;
    /** Точки: на какие точки создавать; `[null]` — один общий документ. */
    buildingIds?: Array<string | null>;
  }
): Promise<CreateReport[]> {
  const results: CreateReport[] = [];
  const targets = args.buildingIds && args.buildingIds.length > 0 ? args.buildingIds : [null];
  for (const code of args.templateCodes) {
    for (const buildingId of targets) {
      results.push(
        await ensureActiveDocument(db, {
          organizationId: args.organizationId,
          templateCode: code,
          now: args.now,
          buildingId,
        })
      );
    }
  }
  return results;
}

/**
 * Look-ahead создание: если активный документ заканчивается через
 * `lookaheadDays` дней или меньше, создаёт документ на следующий период
 * (тот же шаблон, период вычисляется через resolveJournalPeriod на
 * dateTo+1d). Используется в ежедневном cron — за неделю до конца
 * месяца уже есть готовый documеnt на следующий месяц, без сюрприза
 * 1-го числа.
 *
 * Идемпотентно: если следующий документ уже существует — skip с
 * `reason="next-period-exists"`.
 */
export async function ensureNextPeriodDocument(
  db: PrismaClient,
  args: {
    organizationId: string;
    templateCode: string;
    lookaheadDays?: number;
    now?: Date;
    /** См. `ensureActiveDocument.autoFill`. */
    autoFill?: boolean;
    /** См. `ensureActiveDocument.buildingId`. */
    buildingId?: string | null;
  }
): Promise<CreateReport> {
  const now = args.now ?? new Date();
  const lookaheadMs = (args.lookaheadDays ?? 7) * 24 * 60 * 60 * 1000;
  const template = await db.journalTemplate.findFirst({
    where: { code: args.templateCode, isActive: true },
    select: { id: true, name: true },
  });
  if (!template) {
    return {
      code: args.templateCode,
      name: args.templateCode,
      created: false,
      documentId: "",
      reason: "template-not-found",
    };
  }

  // Сравниваем с началом UTC-дня — см. фикс выше.
  const lookaheadTodayUtcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const current = await db.journalDocument.findFirst({
    where: {
      organizationId: args.organizationId,
      templateId: template.id,
      status: "active",
      dateFrom: { lte: lookaheadTodayUtcStart },
      dateTo: { gte: lookaheadTodayUtcStart },
      ...buildingWhere(args.buildingId),
    },
    select: { id: true, dateTo: true },
    orderBy: { dateFrom: "desc" },
  });
  if (!current) {
    return {
      code: args.templateCode,
      name: template.name,
      created: false,
      documentId: "",
      reason: "no-current-active",
    };
  }

  // Сколько до конца? Если > lookaheadDays — рано, не создаём.
  if (current.dateTo.getTime() - now.getTime() > lookaheadMs) {
    return {
      code: args.templateCode,
      name: template.name,
      created: false,
      documentId: current.id,
      reason: "too-early",
    };
  }

  // Период следующего: resolveJournalPeriod(current.dateTo + 1d) с
  // учётом per-template override организации.
  const nextStart = new Date(current.dateTo.getTime() + 24 * 60 * 60 * 1000);
  const orgRowNext = await db.organization.findUnique({
    where: { id: args.organizationId },
    select: {
      journalPeriods: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
    },
  });
  const nextOverrides = parseJournalPeriodsJson(
    orgRowNext?.journalPeriods ?? null
  );
  const nextPeriod = resolveJournalPeriod(
    args.templateCode,
    nextStart,
    nextOverrides
  );

  // Не создаём, если следующий период идентичен текущему (perpetual / single-day).
  if (
    nextPeriod.dateFrom.getTime() === current.dateTo.getTime() ||
    nextPeriod.dateFrom.getTime() <= current.dateTo.getTime()
  ) {
    return {
      code: args.templateCode,
      name: template.name,
      created: false,
      documentId: current.id,
      reason: "no-next-period",
    };
  }

  // Дубликат-защита: документ на следующий период уже создан?
  const existingNext = await db.journalDocument.findFirst({
    where: {
      organizationId: args.organizationId,
      templateId: template.id,
      status: "active",
      dateFrom: nextPeriod.dateFrom,
      ...buildingWhere(args.buildingId),
    },
    select: { id: true },
  });
  if (existingNext) {
    return {
      code: args.templateCode,
      name: template.name,
      created: false,
      documentId: existingNext.id,
      reason: "next-period-exists",
    };
  }

  const prevConfigNext = await fetchPreviousDocConfigForReuse(
    db,
    args.organizationId,
    args.templateCode,
    args.buildingId ?? null,
  );
  const desiredNext = await resolveDesiredResponsibles(db, {
    organizationId: args.organizationId,
    templateId: template.id,
    policy: getJournalAutomation(orgRowNext, args.templateCode).responsibles,
  });
  const prefillNext = await prefillResponsiblesForNewDocument({
    organizationId: args.organizationId,
    journalCode: args.templateCode,
    baseConfig: prevConfigNext ?? {},
    slotOverrides: buildSlotOverrides(args.templateCode, desiredNext),
  });
  const planCfgNext = preplanCleaningConfig(
    args.templateCode,
    prefillNext.config,
    nextPeriod.dateFrom,
    nextPeriod.dateTo,
    now,
  );
  const [responsibleTitleNext, seedEmployeeIdsNext] = await Promise.all([
    loadResponsibleTitle(db, args.organizationId, prefillNext.responsibleUserId),
    resolveSeedEmployeeIds(db, {
      organizationId: args.organizationId,
      templateCode: args.templateCode,
      org: orgRowNext,
    }),
  ]);
  const doc = await db.journalDocument.create({
    data: {
      organizationId: args.organizationId,
      templateId: template.id,
      title: autoDocumentTitle(args.templateCode, template.name, nextPeriod),
      dateFrom: nextPeriod.dateFrom,
      dateTo: nextPeriod.dateTo,
      status: "active",
      autoFill: args.autoFill === true,
      buildingId: args.buildingId ?? null,
      config: planCfgNext as never,
      responsibleUserId: prefillNext.responsibleUserId,
      responsibleTitle: responsibleTitleNext,
      // Phase C: verifierUserId — двухступенчатая проверка не работает
      // без него, заведующая не получает «проверь когда заполнят»
      // в TasksFlow. (Ранее терялся в next-period auto-create — см.
      // тот же фикс в recreate-documents/route.ts.)
      verifierUserId: prefillNext.verifierUserId,
    },
    select: { id: true, dateFrom: true, dateTo: true },
  });
  await seedEntriesForDocument({
    documentId: doc.id,
    journalCode: args.templateCode,
    organizationId: args.organizationId,
    dateFrom: doc.dateFrom,
    dateTo: doc.dateTo,
    responsibleUserId: prefillNext.responsibleUserId,
    employeeIds: seedEmployeeIdsNext,
  }).catch((err) => {
    console.warn(
      `[journal-auto-create:next] seedEntries failed for ${args.templateCode}`,
      err
    );
  });

  // Преемник создан — все документы этого шаблона, чей период уже
  // истёк (dateTo < сегодня), переводим в «закрытые». Тот же переход,
  // что и у кнопки «Отправить в закрытые» (DocumentCloseButton).
  // Perpetual/yearly отфильтровываются внутри.
  await closeExpiredDocuments(db, {
    organizationId: args.organizationId,
    templateId: template.id,
    now,
    overrides: nextOverrides,
  }).catch((err) => {
    console.warn(
      `[journal-auto-create:next] closeExpired failed for ${args.templateCode}`,
      err
    );
    return { closed: 0, documentIds: [] };
  });

  return {
    code: args.templateCode,
    name: template.name,
    created: true,
    documentId: doc.id,
    reason: "next-period-created",
  };
}

/**
 * Догоняющий шаг для ПРЕРВАННОЙ ЦЕПОЧКИ документов.
 *
 * Баг, который он чинит: ежедневный cron создавал документы только по
 * `Organization.autoJournalCodes`. Журналы, которых нет в этом списке
 * (или орг, у которой список пуст вообще), после закрытия последнего
 * документа оставались БЕЗ активного документа навсегда: шаг
 * `closeExpiredDocuments` их закрывал, а создавать было некому.
 * В проде это выглядело так: за ночь закрыто 32 просроченных документа
 * и создано 0 новых — журналы просто опустели.
 *
 * Правило: если у организации КОГДА-ЛИБО был документ этого шаблона
 * (значит журнал документный и им пользовались), но сейчас нет ни
 * одного документа, покрывающего сегодня или будущее, — создаём
 * документ на ТЕКУЩИЙ период (периоды берутся из journal-period.ts с
 * учётом per-org override'ов). Ответственные наследуются из последнего
 * документа, если в /settings/journal-responsibles ничего не задано.
 *
 * Что НЕ трогаем:
 *   • шаблоны без единого документа в орге — журналом не пользовались,
 *     навязывать его не надо;
 *   • `perpetual` (дезсредства, чек-лист сан-дня) — такой документ не
 *     истекает по календарю, его закрывают только руками, и повторное
 *     создание спорило бы с решением менеджера;
 *   • неактивные шаблоны (`JournalTemplate.isActive = false`).
 *
 * Идемпотентно: после создания документ покрывает сегодня, и повторный
 * вызов пропускает шаблон с `reason="has-current-document"`.
 */
export async function ensureCurrentDocumentsForBrokenChains(
  db: PrismaClient,
  args: {
    organizationId: string;
    now?: Date;
    /**
     * Точки (2026-09-05): на какие точки восстанавливать цепочку.
     * `[null]` (по умолчанию) — один общий документ, как раньше.
     */
    buildingIds?: Array<string | null>;
    /**
     * Журналы, отключённые организацией в /settings/journals. Их не
     * восстанавливаем: менеджер выключил журнал осознанно, а цепочка
     * «был документ → истёк → создаём новый» возвращала его каждый месяц.
     */
    skipCodes?: Set<string>;
  }
): Promise<CreateReport[]> {
  const now = args.now ?? new Date();
  const todayUtcStart = startOfUtcDay(now);
  const targets =
    args.buildingIds && args.buildingIds.length > 0 ? args.buildingIds : [null];

  // Один запрос вместо N: шаблоны (и точки), у которых в этой орге есть
  // хоть один документ, вместе с самой поздней датой окончания.
  const groups = await db.journalDocument.groupBy({
    by: ["templateId", "buildingId"],
    where: { organizationId: args.organizationId },
    _max: { dateTo: true },
  });
  if (groups.length === 0) return [];

  const overrides = await loadPeriodOverrides(db, args.organizationId);
  const templateIds = [...new Set(groups.map((group) => group.templateId))];
  const templates = await db.journalTemplate.findMany({
    where: { id: { in: templateIds } },
    select: { id: true, code: true, name: true, isActive: true },
  });
  const templateById = new Map(templates.map((tpl) => [tpl.id, tpl]));
  const isCurrent = (group: { _max: { dateTo: Date | null } }) =>
    Boolean(
      group._max.dateTo &&
        group._max.dateTo.getTime() >= todayUtcStart.getTime(),
    );

  const reports: CreateReport[] = [];
  for (const templateId of templateIds) {
    const template = templateById.get(templateId);
    if (!template || !template.isActive) continue;
    if (args.skipCodes?.has(template.code)) {
      reports.push({
        code: template.code,
        name: template.name,
        created: false,
        documentId: "",
        reason: "journal-disabled",
      });
      continue;
    }
    const tplGroups = groups.filter((group) => group.templateId === templateId);
    // Общий документ (без точки) покрывает все точки, свой — только свою.
    const sharedCurrent = tplGroups.some(
      (group) => (group.buildingId ?? null) === null && isCurrent(group),
    );
    const anyCurrent = tplGroups.some(isCurrent);

    for (const buildingId of targets) {
      const hasCurrent =
        buildingId === null
          ? anyCurrent
          : sharedCurrent ||
            tplGroups.some(
              (group) => group.buildingId === buildingId && isCurrent(group),
            );
      // Есть документ, который покрывает сегодня или начинается позже —
      // цепочка цела (в т.ч. look-ahead документ на следующий период).
      if (hasCurrent) {
        reports.push({
          code: template.code,
          name: template.name,
          created: false,
          documentId: "",
          reason: "has-current-document",
        });
        continue;
      }

      const kind: JournalPeriodKind =
        overrides[template.code]?.kind ?? resolveJournalPeriodKind(template.code);
      if (kind === "perpetual") {
        reports.push({
          code: template.code,
          name: template.name,
          created: false,
          documentId: "",
          reason: "perpetual-manual-only",
        });
        continue;
      }

      const report = await ensureActiveDocument(db, {
        organizationId: args.organizationId,
        templateCode: template.code,
        now,
        inheritResponsiblesFromLastDocument: true,
        buildingId,
      });
      reports.push(
        report.created ? { ...report, reason: "broken-chain-restored" } : report
      );
    }
  }

  return reports;
}
