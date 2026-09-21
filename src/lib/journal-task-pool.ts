import { db } from "@/lib/db";
import { buildingWhere } from "@/lib/building-scope";

/**
 * Per-journal pool generator. Каждый журнал производит список
 * «scope'ов сегодня» — плоский список задач, доступных для claim:
 *   - cleaning:    rooms × cleaners
 *   - hygiene:     один scope-«осмотр смены» на день
 *   - cold_equipment_control: fridges × shifts (morning/evening)
 *   - climate_control:        areas × shifts
 *   - incoming_control:       один открытый pool «приёмка сегодня»
 *   - finished_product:       breakfast/lunch/dinner brakerage
 *   - disinfectant_usage:     один открытый pool «учёт за день»
 *   - fryer_oil:              fryers × day
 *   - med_books / staff_training: per-event, не daily-pool
 *
 * Возвращаем плоский список TaskScope записей с описаниями. Клиент
 * объединяет с existing JournalTaskClaim'ами и рендерит «Доступно /
 * Взято Ивановым / Готово».
 */

export type TaskScope = {
  scopeKey: string;
  scopeLabel: string;
  /** Опциональный sublabel — например, имя зоны/сотрудника. */
  sublabel?: string;
  /** ID документа который эта задача отрабатывает (для links UI). */
  journalDocumentId?: string;
};

export type PoolForDayResult = {
  journalCode: string;
  dateKey: string;
  scopes: TaskScope[];
  /** Если у журнала вообще нет pool-семантики (master-data типа med_books),
   *  возвращаем `pool: false` и UI показывает другую модель. */
  pool: boolean;
};

/**
 * Ключ дня из уже нормализованной даты.
 *
 * ВАЖНО: на вход обязан приходить результат `resolveDayStart(timezone)` —
 * полночь дня организации, выраженная в UTC. Если сюда передать «сейчас»,
 * то с 00:00 до 03:00 по Москве получится вчерашний день: процесс на
 * сервере живёт в UTC. Именно так «Сегодня» показывало вчерашнюю дату, а
 * взятые задачи сохранялись под вчерашним `dateKey`.
 */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Сегмент точки в org-scoped ключах задач: у каждой точки свой набор. */
function buildingSeg(buildingId?: string | null): string {
  return buildingId ? `:${buildingId}` : "";
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Главная диспетчерская функция — по journalCode выбирает нужный
 * генератор. Все генераторы фильтруют по organizationId и dateKey.
 */
export async function generatePoolForDay(args: {
  organizationId: string;
  journalCode: string;
  /**
   * День организации — результат `resolveDayStart(org.timezone, now)`,
   * а не `new Date()`. См. комментарий к `dayKey` выше.
   */
  date: Date;
  /** Точка: документ и ключи задач ограничиваются ею; null — без точек. */
  buildingId?: string | null;
}): Promise<PoolForDayResult> {
  const today = utcMidnight(args.date);
  const todayKey = dayKey(today);
  const journalCode = args.journalCode;

  switch (journalCode) {
    case "hygiene":
    case "health_check":
      return poolHygieneShift({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey, journalCode });
    case "cold_equipment_control":
      return poolColdEquipment({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey });
    case "climate_control":
      return poolClimate({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey });
    case "incoming_control":
      return poolIncoming({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey });
    case "finished_product":
      return poolFinishedProduct({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey });
    case "disinfectant_usage":
      return poolDisinfectant({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey });
    case "fryer_oil":
      return poolFryerOil({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey });
    case "cleaning":
      return poolCleaning({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey });
    case "accident_journal":
    case "complaint_register":
    case "breakdown_history":
    case "ppe_issuance":
    case "glass_items_list":
    case "metal_impurity":
    case "perishable_rejection":
    case "product_writeoff":
    case "traceability_test":
      // Event-based: pool = «один открытый event-slot на день».
      return poolGenericEvent({
        organizationId: args.organizationId,
        buildingId: args.buildingId ?? null,
        today,
        todayKey,
        journalCode,
        label: GENERIC_EVENT_LABELS[journalCode] ?? "Запись за день",
      });
    case "general_cleaning":
    case "sanitation_day_control":
    case "sanitary_day_control":
      // Периодические: per-day одна задача.
      return poolGenericEvent({
        organizationId: args.organizationId,
        buildingId: args.buildingId ?? null,
        today,
        todayKey,
        journalCode,
        label: GENERIC_EVENT_LABELS[journalCode] ?? journalCode,
      });
    case "pest_control":
    case "intensive_cooling":
    case "glass_control":
      return poolGenericEvent({
        organizationId: args.organizationId,
        buildingId: args.buildingId ?? null,
        today,
        todayKey,
        journalCode,
        label: GENERIC_EVENT_LABELS[journalCode] ?? journalCode,
      });
    case "uv_lamp_runtime":
      return poolUvLamp({ organizationId: args.organizationId, buildingId: args.buildingId ?? null, today, todayKey });
    case "equipment_maintenance":
    case "equipment_calibration":
    case "equipment_cleaning":
      return poolEquipmentEvent({
        organizationId: args.organizationId,
        buildingId: args.buildingId ?? null,
        today,
        todayKey,
        journalCode,
      });
    case "audit_plan":
    case "audit_protocol":
    case "audit_report":
      return poolGenericEvent({
        organizationId: args.organizationId,
        buildingId: args.buildingId ?? null,
        today,
        todayKey,
        journalCode,
        label: GENERIC_EVENT_LABELS[journalCode] ?? journalCode,
      });
    case "training_plan":
      return poolGenericEvent({
        organizationId: args.organizationId,
        buildingId: args.buildingId ?? null,
        today,
        todayKey,
        journalCode,
        label: "План обучения — отметить выполнение",
      });
    default:
      return { journalCode, dateKey: todayKey, scopes: [], pool: false };
  }
}

const GENERIC_EVENT_LABELS: Record<string, string> = {
  accident_journal: "Регистрация ЧП",
  complaint_register: "Жалоба",
  breakdown_history: "Поломка / починка",
  ppe_issuance: "Выдача СИЗ",
  glass_items_list: "Учёт стеклянной/пластиковой посуды",
  metal_impurity: "Контроль металлопримесей",
  perishable_rejection: "Утилизация скоропорта",
  product_writeoff: "Списание продукции",
  traceability_test: "Прослеживаемость",
  general_cleaning: "Генеральная уборка",
  sanitation_day_control: "Санитарный день",
  // Отдельный журнал — «Чек-лист (памятка) проведения санитарного дня».
  // С одинаковой подписью две задачи на «Сегодня» было не различить.
  sanitary_day_control: "Чек-лист сан. дня",
  pest_control: "Дератизация / дезинсекция",
  intensive_cooling: "Интенсивное охлаждение",
  glass_control: "Контроль стекла",
  audit_plan: "План аудита",
  audit_protocol: "Протокол аудита",
  audit_report: "Отчёт аудита",
};

/**
 * Слова, по которым узнаём холодильное оборудование в карточке.
 * Совпадение ищем и в типе, и в названии — тип заполняют не всегда.
 */
const COLD_EQUIPMENT_MARKERS = [
  "fridge",
  "refriger",
  "freezer",
  "chill",
  "cold",
  "холодильн",
  "морозиль",
  "морозил",
  "камера хранения",
  "шкаф шоковой",
  "ларь",
] as const;

/* ---------- per-journal generators ---------- */

async function poolHygieneShift(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
  journalCode: string;
}): Promise<PoolForDayResult> {
  // Активный документ за день (любой in-period).
  const doc = await activeDocFor(args.organizationId, args.journalCode, args.today, args.buildingId);
  return {
    journalCode: args.journalCode,
    dateKey: args.todayKey,
    pool: true,
    scopes: doc
      ? [
          {
            scopeKey: `hygiene-shift:${doc.id}:${args.todayKey}`,
            scopeLabel:
              args.journalCode === "health_check"
                ? "Проверка здоровья смены"
                : "Гигиенический осмотр смены",
            sublabel: doc.title,
            journalDocumentId: doc.id,
          },
        ]
      : [],
  };
}

async function poolColdEquipment(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
}): Promise<PoolForDayResult> {
  // Берём только холодильное оборудование. Раньше сюда попадало ВСЁ
  // оборудование организации, и в группе «Холодильники» появлялась
  // задача «Термогигрометр цеха — Утро»: у датчика нечего замерять
  // термометром, а заведующая видела вечно невыполненную строку.
  //
  // Признак тот же, что и у самого журнала: тип холодильного
  // оборудования ИЛИ заданная в карточке норма температуры (её ставят
  // именно тем единицам, которые в этот журнал и попадают).
  const fridges = await db.equipment.findMany({
    where: {
      area: { organizationId: args.organizationId },
      OR: [
        ...COLD_EQUIPMENT_MARKERS.flatMap((marker) => [
          { type: { contains: marker, mode: "insensitive" as const } },
          { name: { contains: marker, mode: "insensitive" as const } },
        ]),
        { AND: [{ tempMin: { not: null } }, { tempMax: { not: null } }] },
      ],
    },
    select: { id: true, name: true, type: true, area: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const doc = await activeDocFor(args.organizationId, "cold_equipment_control", args.today, args.buildingId);
  const shifts: { code: "morning" | "evening"; label: string }[] = [
    { code: "morning", label: "Утро" },
    { code: "evening", label: "Вечер" },
  ];
  const scopes: TaskScope[] = [];
  for (const f of fridges) {
    for (const s of shifts) {
      scopes.push({
        scopeKey: `fridge:${f.id}:${s.code}:${args.todayKey}`,
        scopeLabel: `${f.name} — ${s.label}`,
        sublabel: f.area?.name,
        journalDocumentId: doc?.id,
      });
    }
  }
  return { journalCode: "cold_equipment_control", dateKey: args.todayKey, pool: true, scopes };
}

async function poolClimate(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
}): Promise<PoolForDayResult> {
  // 2026-09-04: единый справочник помещений — Room, а не legacy Area.
  // Заявки живут один день, смена ключа `area:` → `room:` безопасна.
  const rooms = await db.room.findMany({
    where: {
      building: {
        organizationId: args.organizationId,
        ...(args.buildingId ? { id: args.buildingId } : {}),
      },
    },
    select: { id: true, name: true },
    orderBy: [{ buildingId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const doc = await activeDocFor(args.organizationId, "climate_control", args.today, args.buildingId);
  const shifts = ["morning", "evening"] as const;
  const scopes: TaskScope[] = [];
  for (const a of rooms) {
    for (const s of shifts) {
      scopes.push({
        scopeKey: `room:${a.id}:${s}:${args.todayKey}`,
        scopeLabel: `${a.name} — ${s === "morning" ? "Утро" : "Вечер"}`,
        sublabel: "Климат-контроль",
        journalDocumentId: doc?.id,
      });
    }
  }
  return { journalCode: "climate_control", dateKey: args.todayKey, pool: true, scopes };
}

async function poolIncoming(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
}): Promise<PoolForDayResult> {
  const doc = await activeDocFor(args.organizationId, "incoming_control", args.today, args.buildingId);
  return {
    journalCode: "incoming_control",
    dateKey: args.todayKey,
    pool: true,
    scopes: [
      {
        scopeKey: `incoming:${args.organizationId}:${args.todayKey}${buildingSeg(args.buildingId)}`,
        scopeLabel: "Приёмка сырья сегодня",
        sublabel: doc ? doc.title : "Один сотрудник проводит приёмки за день",
        journalDocumentId: doc?.id,
      },
    ],
  };
}

async function poolFinishedProduct(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
}): Promise<PoolForDayResult> {
  const doc = await activeDocFor(args.organizationId, "finished_product", args.today, args.buildingId);
  const meals: { code: string; label: string }[] = [
    { code: "breakfast", label: "Завтрак" },
    { code: "lunch", label: "Обед" },
    { code: "dinner", label: "Ужин" },
  ];
  const scopes = meals.map((m) => ({
    scopeKey: `meal:${m.code}:${args.todayKey}${buildingSeg(args.buildingId)}`,
    scopeLabel: `Бракераж · ${m.label}`,
    sublabel: doc?.title,
    journalDocumentId: doc?.id,
  }));
  return { journalCode: "finished_product", dateKey: args.todayKey, pool: true, scopes };
}

async function poolDisinfectant(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
}): Promise<PoolForDayResult> {
  const doc = await activeDocFor(args.organizationId, "disinfectant_usage", args.today, args.buildingId);
  return {
    journalCode: "disinfectant_usage",
    dateKey: args.todayKey,
    pool: true,
    scopes: [
      {
        scopeKey: `disinf:${args.organizationId}:${args.todayKey}${buildingSeg(args.buildingId)}`,
        scopeLabel: "Учёт дезсредств за день",
        sublabel: doc ? doc.title : "Кто разводит — тот и записывает",
        journalDocumentId: doc?.id,
      },
    ],
  };
}

async function poolFryerOil(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
}): Promise<PoolForDayResult> {
  const fryers = await db.equipment.findMany({
    where: {
      area: { organizationId: args.organizationId },
      OR: [
        { type: { contains: "fryer", mode: "insensitive" } },
        { type: { contains: "фритюр", mode: "insensitive" } },
        { name: { contains: "фритюр", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, area: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const doc = await activeDocFor(args.organizationId, "fryer_oil", args.today, args.buildingId);
  const scopes: TaskScope[] = fryers.map((f) => ({
    scopeKey: `fryer:${f.id}:${args.todayKey}`,
    scopeLabel: `Фритюр · ${f.name}`,
    sublabel: f.area?.name,
    journalDocumentId: doc?.id,
  }));
  // Fallback: если фритюров нет в каталоге — один общий scope за день.
  if (scopes.length === 0) {
    scopes.push({
      scopeKey: `fryer:default:${args.todayKey}${buildingSeg(args.buildingId)}`,
      scopeLabel: "Фритюрный жир — контроль",
      sublabel: doc?.title ?? undefined,
      journalDocumentId: doc?.id,
    });
  }
  return { journalCode: "fryer_oil", dateKey: args.todayKey, pool: true, scopes };
}

async function poolCleaning(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
}): Promise<PoolForDayResult> {
  const doc = await activeDocFor(args.organizationId, "cleaning", args.today, args.buildingId);
  if (!doc) {
    return { journalCode: "cleaning", dateKey: args.todayKey, pool: true, scopes: [] };
  }
  // Cleaning rooms-mode уже хранит selectedRoomIds в config — берём оттуда.
  const config = (doc.config ?? {}) as Record<string, unknown>;
  const selectedRoomIds = Array.isArray(config.selectedRoomIds)
    ? (config.selectedRoomIds as string[])
    : [];
  if (selectedRoomIds.length === 0) {
    return { journalCode: "cleaning", dateKey: args.todayKey, pool: true, scopes: [] };
  }
  const rooms = await db.room.findMany({
    where: {
      id: { in: selectedRoomIds },
      building: {
        organizationId: args.organizationId,
        ...(args.buildingId ? { id: args.buildingId } : {}),
      },
    },
    select: { id: true, name: true, building: { select: { name: true } } },
  });
  return {
    journalCode: "cleaning",
    dateKey: args.todayKey,
    pool: true,
    scopes: rooms.map((r) => ({
      scopeKey: `room:${r.id}:${args.todayKey}`,
      scopeLabel: `Уборка · ${r.name}`,
      sublabel: r.building.name,
      journalDocumentId: doc.id,
    })),
  };
}

async function poolUvLamp(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
}): Promise<PoolForDayResult> {
  // UV-лампы по их Equipment с типом uv_lamp / уф / ультра в названии.
  const lamps = await db.equipment.findMany({
    where: {
      area: { organizationId: args.organizationId },
      OR: [
        { type: { contains: "uv", mode: "insensitive" } },
        { type: { contains: "уф", mode: "insensitive" } },
        { type: { contains: "ультра", mode: "insensitive" } },
        { name: { contains: "уф", mode: "insensitive" } },
        { name: { contains: "бактерицид", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, area: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const doc = await activeDocFor(args.organizationId, "uv_lamp_runtime", args.today, args.buildingId);
  const scopes: TaskScope[] =
    lamps.length > 0
      ? lamps.map((l) => ({
          scopeKey: `uv:${l.id}:${args.todayKey}`,
          scopeLabel: `УФ-лампа · ${l.name}`,
          sublabel: l.area?.name,
          journalDocumentId: doc?.id,
        }))
      : [
          {
            scopeKey: `uv:default:${args.todayKey}${buildingSeg(args.buildingId)}`,
            scopeLabel: "УФ-лампа — отметить наработку",
            sublabel: doc?.title,
            journalDocumentId: doc?.id,
          },
        ];
  return { journalCode: "uv_lamp_runtime", dateKey: args.todayKey, pool: true, scopes };
}

async function poolEquipmentEvent(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
  journalCode: string;
}): Promise<PoolForDayResult> {
  const equipment = await db.equipment.findMany({
    where: { area: { organizationId: args.organizationId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const doc = await activeDocFor(args.organizationId, args.journalCode, args.today, args.buildingId);
  // Один общий event-slot — событийный журнал. Сотрудник выберет
  // оборудование уже в форме.
  return {
    journalCode: args.journalCode,
    dateKey: args.todayKey,
    pool: true,
    scopes: [
      {
        scopeKey: `${args.journalCode}:${args.organizationId}:${args.todayKey}${buildingSeg(args.buildingId)}`,
        scopeLabel:
          args.journalCode === "equipment_maintenance"
            ? "Тех. обслуживание оборудования"
            : args.journalCode === "equipment_calibration"
              ? "Поверка / калибровка"
              : "Чистка оборудования",
        sublabel: equipment.length > 0 ? `Доступно ${equipment.length} единиц` : doc?.title,
        journalDocumentId: doc?.id,
      },
    ],
  };
}

async function poolGenericEvent(args: {
  organizationId: string;
  buildingId?: string | null;
  today: Date;
  todayKey: string;
  journalCode: string;
  label: string;
}): Promise<PoolForDayResult> {
  const doc = await activeDocFor(args.organizationId, args.journalCode, args.today, args.buildingId);
  return {
    journalCode: args.journalCode,
    dateKey: args.todayKey,
    pool: true,
    scopes: [
      {
        scopeKey: `${args.journalCode}:${args.organizationId}:${args.todayKey}${buildingSeg(args.buildingId)}`,
        scopeLabel: `${args.label} — записать сегодня`,
        sublabel: doc?.title,
        journalDocumentId: doc?.id,
      },
    ],
  };
}

/* ---------- helpers ---------- */

async function activeDocFor(
  organizationId: string,
  journalCode: string,
  today: Date,
  buildingId?: string | null
): Promise<{ id: string; title: string; config: unknown } | null> {
  const doc = await db.journalDocument.findFirst({
    where: {
      organizationId,
      status: "active",
      template: { code: journalCode },
      dateFrom: { lte: today },
      dateTo: { gte: today },
      ...buildingWhere(buildingId),
    },
    select: { id: true, title: true, config: true },
    orderBy: { createdAt: "desc" },
  });
  return doc;
}
