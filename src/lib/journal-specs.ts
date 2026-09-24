/**
 * Реестр спецификаций всех журналов: правила заполнения по СанПиН/ХАССП.
 *
 * Связано с:
 *   • docs/JOURNAL-SPECS.md — текстовое описание для людей.
 *   • src/lib/journal-task-modes.ts — distribution + verification.
 *   • src/lib/journal-workload.ts — расчёт нагрузки.
 *   • src/lib/journal-responsible-schemas.ts — слоты ответственных.
 *
 * Этот файл — единственный источник правды для UI/Tasks-flow о том,
 * как должен заполняться каждый журнал. Если меняется поведение —
 * меняется здесь, а UI/serv читают.
 */

export type JournalCategory =
  | "personnel" // здоровье / гигиена / СИЗ / обучение
  | "intake" // приёмка и входной контроль
  | "temperature" // температурный режим
  | "cleaning" // уборка / санитария
  | "production" // приготовление / бракераж
  | "equipment" // оборудование
  | "audit" // аудит / отчёты
  | "incidents"; // ЧП / жалобы

export type RollingPolicy = {
  /** Жёсткий лимит rolling-задач на одного сотрудника в день. */
  dailyCap: number;
  /** Текст кнопки «Сохранить и продолжить». */
  continueLabel: string;
  /** Текст кнопки «Готово на сегодня». */
  doneLabel: string;
  /** Подсказка для счётчика «За сегодня заполнено». */
  counterLabel: string;
};

export type FillingGuide = {
  /// 1-2 предложения «что и зачем» — для нового сотрудника.
  summary: string;
  /// Что взять с собой перед началом задачи.
  materials: string[];
  /// Пошаговая инструкция «как делать», от начала до конца.
  steps: Array<{
    title: string;
    detail: string;
  }>;
  /// Когда задача считается выполненной (acceptance criteria).
  completionCriteria: string;
  /// Топ-3 типичные ошибки новичков, которые нужно избежать.
  commonMistakes: string[];
  /// СанПиН/ХАССП пункт + краткая цитата из норматива.
  regulationRef: string;
};

export type JournalSpec = {
  code: string;
  category: JournalCategory;
  /// Краткое описание workflow для UI tooltip'ов.
  shortDescription: string;
  /// СанПиН/ХАССП ссылка.
  regulation: string;
  /// Можно ли включить rolling-режим на этом журнале (UI dropdown'у).
  rollingAllowed: boolean;
  /// Дефолтный режим rolling (если включён) — параметры loop'а.
  rolling?: RollingPolicy;
  /// Можно ли multi-row form (5 холодильников = 5 строк в одной форме).
  multiRowAllowed: boolean;
  /// Требуется ли фото обязательно для completion.
  photoRequired: boolean;
  /// Рекомендуется ли фото (UI подсказывает но не блокирует save).
  photoRecommended: boolean;
  /// Поля которые становятся обязательными при отклонении нормы.
  conditionalRequiredOnDeviation?: string[];
  /// Time-window — если последняя запись > N часов назад, виджет
  /// «нужно сейчас». null если не применимо.
  timeWindowHours: number | null;
  /// Sprint-compliance: подробный гайд для нового сотрудника. Показывается
  /// сверху формы заполнения (collapsible) и на отдельной странице
  /// /journals/<code>/guide. Если null — fallback на shortDescription.
  fillingGuide?: FillingGuide;
};

const DEFAULT_ROLLING: RollingPolicy = {
  dailyCap: 50,
  continueLabel: "Сохранить и продолжить",
  doneLabel: "Готово на сегодня",
  counterLabel: "За сегодня заполнено",
};

/**
 * Полный реестр для всех 36 журналов из ACTIVE_JOURNAL_CATALOG.
 * Журналы не из списка падают на DEFAULT_SPEC через getJournalSpec().
 */
const REGISTRY: Record<string, JournalSpec> = {
  // ═══ PERSONNEL ═══
  hygiene: {
    code: "hygiene",
    category: "personnel",
    shortDescription:
      "Утренний осмотр каждого сотрудника перед сменой. Допуск к работе или отстранение с причиной.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    conditionalRequiredOnDeviation: ["reason", "actions"],
    timeWindowHours: 24,
  },
  health_check: {
    code: "health_check",
    category: "personnel",
    shortDescription:
      "На практике сливают с гигиеническим — отметка о здоровье каждого работника утром.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    conditionalRequiredOnDeviation: ["reason", "actions"],
    timeWindowHours: 24,
  },
  med_books: {
    code: "med_books",
    category: "personnel",
    shortDescription:
      "Реестр у админа/кадров. Срок действия отслеживается, реминд за 30 дней.",
    regulation: "СанПиН 2.3/2.4.4282-26 + ФЗ № 52",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  staff_training: {
    code: "staff_training",
    category: "personnel",
    shortDescription:
      "Запись об инструктаже для каждого сотрудника. Вводный при найме + повторный раз в полгода.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  ppe_issuance: {
    code: "ppe_issuance",
    category: "personnel",
    shortDescription: "Учёт выданных СИЗ — при найме и при износе.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },

  // ═══ INTAKE ═══
  incoming_control: {
    code: "incoming_control",
    category: "intake",
    shortDescription:
      "Приёмка каждой партии. Может быть 1-15 раз в день — rolling режим уместен.",
    regulation: "СанПиН 2.3/2.4.4282-26 + ХАССП ССР1",
    rollingAllowed: true,
    rolling: { ...DEFAULT_ROLLING, dailyCap: 30 },
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    conditionalRequiredOnDeviation: ["return_reason"],
    timeWindowHours: null,
  },
  incoming_raw_materials_control: {
    code: "incoming_raw_materials_control",
    category: "intake",
    shortDescription:
      "Расширенный входной контроль сырья — с проверкой сертификатов и маркировки.",
    regulation: "ТР ТС 021/2011 + ХАССП ССР1",
    rollingAllowed: true,
    rolling: { ...DEFAULT_ROLLING, dailyCap: 30 },
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    conditionalRequiredOnDeviation: ["return_reason"],
    timeWindowHours: null,
  },
  perishable_rejection: {
    code: "perishable_rejection",
    category: "intake",
    shortDescription:
      "Бракераж скоропортящейся продукции при поступлении. Каждая партия отдельно.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: true,
    rolling: { ...DEFAULT_ROLLING, dailyCap: 30 },
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    conditionalRequiredOnDeviation: ["organoleptic_deviation_reason"],
    timeWindowHours: null,
  },
  metal_impurity: {
    code: "metal_impurity",
    category: "intake",
    shortDescription:
      "Контроль металлопримесей в муке/специях/крупах через магнит/детектор.",
    regulation: "ХАССП ССР3 (физический риск)",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    conditionalRequiredOnDeviation: ["found_details"],
    timeWindowHours: null,
  },

  // ═══ TEMPERATURE ═══
  cold_equipment_control: {
    code: "cold_equipment_control",
    category: "temperature",
    shortDescription:
      "Утром и вечером — температура каждого холодильника. Норма 0…+6°C.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    conditionalRequiredOnDeviation: ["deviation_action"],
    timeWindowHours: 6,
  },
  climate_control: {
    code: "climate_control",
    category: "temperature",
    shortDescription:
      "Температура и влажность в помещениях хранения 2 раза в день.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    conditionalRequiredOnDeviation: ["deviation_action"],
    timeWindowHours: 6,
  },
  intensive_cooling: {
    code: "intensive_cooling",
    category: "temperature",
    shortDescription:
      "Каждая горячая партия после варки: с +65°C до +5°C за ≤2 часов. Rolling уместен.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: true,
    rolling: { ...DEFAULT_ROLLING, dailyCap: 30 },
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    conditionalRequiredOnDeviation: ["deviation_reason"],
    timeWindowHours: null,
  },
  uv_lamp_runtime: {
    code: "uv_lamp_runtime",
    category: "temperature",
    shortDescription: "Каждое включение УФ-лампы — время работы.",
    regulation: "СанПиН по эксплуатации УФ-установок",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },

  // ═══ CLEANING ═══
  cleaning: {
    code: "cleaning",
    category: "cleaning",
    shortDescription:
      "Уборка каждой зоны перед сменой — старший по уборке + контролёр.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    timeWindowHours: 24,
  },
  general_cleaning: {
    code: "general_cleaning",
    category: "cleaning",
    shortDescription: "Генеральная уборка раз в неделю по графику.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    timeWindowHours: null,
  },
  cleaning_ventilation_checklist: {
    code: "cleaning_ventilation_checklist",
    category: "cleaning",
    shortDescription:
      "Ежедневный чек-лист уборки и проветривания каждого помещения.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: 24,
  },
  sanitary_day_control: {
    code: "sanitary_day_control",
    category: "cleaning",
    shortDescription: "Ежемесячный санитарный день — чек-лист 30 пунктов.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  disinfectant_usage: {
    code: "disinfectant_usage",
    category: "cleaning",
    shortDescription:
      "Каждое использование дезинфектанта: препарат, концентрация, что обработали. Rolling уместен.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: true,
    rolling: { ...DEFAULT_ROLLING, dailyCap: 30 },
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    timeWindowHours: null,
  },
  equipment_cleaning: {
    code: "equipment_cleaning",
    category: "cleaning",
    shortDescription: "Мойка оборудования после каждой смены.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  pest_control: {
    code: "pest_control",
    category: "cleaning",
    shortDescription: "Дератизация / дезинсекция раз в квартал по договору.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: true,
    photoRecommended: false,
    timeWindowHours: null,
  },

  // ═══ PRODUCTION ═══
  finished_product: {
    code: "finished_product",
    category: "production",
    shortDescription:
      "Бракераж каждого готового блюда до раздачи. Rolling — повар сам решает сколько раз.",
    regulation: "СанПиН 2.3/2.4.4282-26 + ХАССП ССР6",
    rollingAllowed: true,
    rolling: { ...DEFAULT_ROLLING, dailyCap: 50 },
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    conditionalRequiredOnDeviation: ["deviation_reason", "decision"],
    timeWindowHours: null,
  },
  product_writeoff: {
    code: "product_writeoff",
    category: "production",
    shortDescription: "Акт забраковки — комиссия из 3 (шеф + товаровед + управляющий).",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: true,
    photoRecommended: false,
    timeWindowHours: null,
  },
  fryer_oil: {
    code: "fryer_oil",
    category: "production",
    shortDescription:
      "Учёт фритюрных жиров — каждое включение/проверка полярности.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: true,
    rolling: { ...DEFAULT_ROLLING, dailyCap: 20 },
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    conditionalRequiredOnDeviation: ["replacement_reason"],
    timeWindowHours: null,
  },
  traceability_test: {
    code: "traceability_test",
    category: "production",
    shortDescription:
      "Тест прослеживаемости раз в месяц — партия → блюдо → дата отпуска.",
    regulation: "ХАССП требование",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },

  // ═══ EQUIPMENT ═══
  equipment_calibration: {
    code: "equipment_calibration",
    category: "equipment",
    shortDescription:
      "Поверка средств измерений раз в год. Реминд за 30 дней до окончания свидетельства.",
    regulation: "ФЗ Об обеспечении единства измерений",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: true,
    photoRecommended: false,
    timeWindowHours: null,
  },
  equipment_maintenance: {
    code: "equipment_maintenance",
    category: "equipment",
    shortDescription: "Профилактическое ТО оборудования раз в месяц по графику.",
    regulation: "СанПиН + паспорта оборудования",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: true,
    timeWindowHours: null,
  },
  breakdown_history: {
    code: "breakdown_history",
    category: "equipment",
    shortDescription: "Карточка истории поломок — по событию.",
    regulation: "Внутренний учёт",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    timeWindowHours: null,
  },
  glass_items_list: {
    code: "glass_items_list",
    category: "equipment",
    shortDescription: "Реестр изделий из стекла — обновляется при изменениях.",
    regulation: "ХАССП — физический риск",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  glass_control: {
    code: "glass_control",
    category: "equipment",
    shortDescription:
      "Еженедельная проверка реестра — все изделия на месте, нет битых.",
    regulation: "ХАССП — физический риск",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },

  // ═══ AUDIT ═══
  audit_plan: {
    code: "audit_plan",
    category: "audit",
    shortDescription: "План внутренних аудитов на год.",
    regulation: "ХАССП — обязательный план",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  audit_protocol: {
    code: "audit_protocol",
    category: "audit",
    shortDescription: "Протокол внутреннего аудита — ежемесячно.",
    regulation: "ХАССП",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    timeWindowHours: null,
  },
  audit_report: {
    code: "audit_report",
    category: "audit",
    shortDescription: "Сводный отчёт по результатам аудитов.",
    regulation: "ХАССП",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  training_plan: {
    code: "training_plan",
    category: "audit",
    shortDescription: "План обучения персонала — раз в полугодие.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },

  // ═══ INCIDENTS ═══
  accident_journal: {
    code: "accident_journal",
    category: "incidents",
    shortDescription: "Журнал учёта аварий — по событию + уведомление Роспотребнадзора.",
    regulation: "Внутренний учёт + ФЗ № 52",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: true,
    photoRecommended: false,
    timeWindowHours: null,
  },
  complaint_register: {
    code: "complaint_register",
    category: "incidents",
    shortDescription: "Реестр жалоб от гостей — каждая отдельно.",
    regulation: "ФЗ О защите прав потребителей",
    rollingAllowed: false,
    multiRowAllowed: false,
    photoRequired: false,
    photoRecommended: true,
    timeWindowHours: null,
  },
  tableware_breakage: {
    code: "tableware_breakage",
    category: "incidents",
    shortDescription: "Бой посуды — по событию, с отметкой о сборе осколков.",
    regulation: "Внутренняя процедура ХАССП (физические опасности)",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },

  // ═══ ТАБЛИЧНЫЕ РЕЕСТРЫ: ПИТАНИЕ, ПЕРЕВОЗКА, БАССЕЙН ═══
  daily_samples: {
    code: "daily_samples",
    category: "production",
    shortDescription: "Суточные пробы — от каждого приёма пищи, хранение 48 часов.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  vitaminization: {
    code: "vitaminization",
    category: "production",
    shortDescription: "Витаминизация третьих блюд — перед раздачей.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  ration_control: {
    code: "ration_control",
    category: "production",
    shortDescription: "Рацион против норм — раз в 10 дней или в месяц.",
    regulation: "СанПиН 2.3/2.4.4282-26",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  transport_temperature: {
    code: "transport_temperature",
    category: "temperature",
    shortDescription: "Температура при перевозке — загрузка и выгрузка каждого рейса.",
    regulation: "ТР ТС 021/2011",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  pool_water_control: {
    code: "pool_water_control",
    category: "cleaning",
    shortDescription: "Вода в бассейне — хлор, pH, температура до открытия и по графику.",
    regulation: "СП 2.1.3678-20",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },

  // ═══ ТАБЛИЧНЫЕ РЕЕСТРЫ: ИНВЕНТАРЬ, САЛОНЫ, ВЫПУСК ПРОДУКЦИИ ═══
  inventory_condition: {
    code: "inventory_condition",
    category: "equipment",
    shortDescription: "Осмотр инвентаря — сколы, трещины, ржавчина; повреждённое изымается.",
    regulation: "Внутренняя процедура ХАССП (физические опасности)",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: true,
    timeWindowHours: null,
  },
  instrument_sterilization: {
    code: "instrument_sterilization",
    category: "cleaning",
    shortDescription: "Стерилизация инструментов — каждый цикл со способом, режимом и индикатором.",
    regulation: "СанПиН 2.1.3678-20",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  medical_waste_b: {
    code: "medical_waste_b",
    category: "cleaning",
    shortDescription: "Отходы класса Б — сбор, обеззараживание, передача вывозящей организации.",
    regulation: "СанПиН 2.1.3684-21",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
  batch_release: {
    code: "batch_release",
    category: "production",
    shortDescription: "Допуск партии к отгрузке — что проверено и решение.",
    regulation: "ТР ТС 021/2011",
    rollingAllowed: false,
    multiRowAllowed: true,
    photoRequired: false,
    photoRecommended: false,
    timeWindowHours: null,
  },
};

const DEFAULT_SPEC: JournalSpec = {
  code: "",
  category: "production",
  shortDescription: "Общий журнал — стандартная форма.",
  regulation: "СанПиН 2.3/2.4.4282-26",
  rollingAllowed: false,
  multiRowAllowed: false,
  photoRequired: false,
  photoRecommended: false,
  timeWindowHours: null,
};

/** Возвращает спецификацию для журнала. Если кода нет в реестре — DEFAULT. */
export function getJournalSpec(code: string): JournalSpec {
  return REGISTRY[code] ?? { ...DEFAULT_SPEC, code };
}

/** Все коды для которых rollingAllowed === true. */
export function getRollingCapableJournalCodes(): string[] {
  return Object.values(REGISTRY)
    .filter((s) => s.rollingAllowed)
    .map((s) => s.code);
}

export const JOURNAL_CATEGORY_LABELS: Record<JournalCategory, string> = {
  personnel: "Персонал и здоровье",
  intake: "Приёмка и входной контроль",
  temperature: "Температурный режим",
  cleaning: "Уборка и санитария",
  production: "Приготовление",
  equipment: "Оборудование",
  audit: "Аудит и обучение",
  incidents: "ЧП и жалобы",
};

export { REGISTRY as JOURNAL_SPEC_REGISTRY };
