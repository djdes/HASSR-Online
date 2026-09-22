/**
 * Onboarding-пресеты «должность → журналы» для типов организаций.
 *
 * Зачем: новая компания при регистрации получает 35 журналов и 0 должностей.
 * При первом «Отправить всем на заполнение» все 23 задачи уходят первому
 * сотруднику в алфавите — потому что нет per-position visibility.
 *
 * Решение: одной кнопкой «Применить шаблон <type>» создаём:
 *   1. Канонические должности (Управляющий, Шеф-повар, Повар, Официант, Уборщик, …)
 *   2. JobPositionJournalAccess — кто за какие журналы отвечает
 *
 * Дальше при «Отправить всем» система раздаёт задачи по ролям корректно.
 *
 * Презеты совпадают со списком type из формы регистрации:
 *   restaurant | meat | dairy | bakery | confectionery | other
 */

import { withDefaultOffCodes } from "@/lib/health-check-default-off";

type JobPositionCategoryKey = "management" | "staff";

export type OrgType =
  | "restaurant"
  | "meat"
  | "dairy"
  | "bakery"
  | "confectionery"
  | "other";

export interface PresetPosition {
  /** Имя должности (то же что хранится в JobPosition.name) */
  name: string;
  /** Категория: management | staff */
  category: JobPositionCategoryKey;
  /** Какие journal codes по умолчанию доступны этой должности */
  journalCodes: readonly string[];
}

export interface OrgTypePreset {
  type: OrgType;
  label: string;
  positions: readonly PresetPosition[];
  /** Журналы которые этой компании скорее всего НЕ нужны (отключить
   *  через disabledJournalCodes на старте). Пусто = оставить все 35. */
  disabledJournalCodes?: readonly string[];
  /** Какие журналы автосоздавать каждый месяц (Organization.autoJournalCodes).
   *  Подмножество active-журналов для типа. По умолчанию — ежедневные. */
  autoJournalCodes?: readonly string[];
}

/**
 * Все коды журналов в системе. Хардкоженый список нужен чтобы
 * `disabledJournalCodes` пресета мог быть declared как «всё кроме этого
 * подмножества» — в /api/onboarding/apply мы вычисляем diff и пишем
 * `Organization.disabledJournalCodes`. Если список расходится с
 * реальностью БД — preset игнорирует неизвестные коды (см. apply
 * route), это безопасно но добавит лишний журнал в дашборде.
 */
export const ALL_JOURNAL_CODES: readonly string[] = [
  "hygiene",
  "health_check",
  "cleaning",
  "general_cleaning",
  "cleaning_ventilation_checklist",
  "uv_lamp_runtime",
  "disinfectant_usage",
  "sanitary_day_control",
  "pest_control",
  "climate_control",
  "cold_equipment_control",
  "intensive_cooling",
  "finished_product",
  "perishable_rejection",
  "incoming_control",
  "incoming_raw_materials_control",
  "fryer_oil",
  "product_writeoff",
  "metal_impurity",
  "traceability_test",
  "equipment_cleaning",
  "equipment_maintenance",
  "breakdown_history",
  "equipment_calibration",
  "glass_items_list",
  "glass_control",
  "med_books",
  "training_plan",
  "staff_training",
  "ppe_issuance",
  "audit_plan",
  "audit_protocol",
  "audit_report",
  "accident_journal",
  "complaint_register",
] as const;

// Каноничные группы журналов — переиспользуем во всех пресетах.
// health_check сюда не входит: журнал здоровья выключен по умолчанию
// (см. health-check-default-off.ts), его включают руками.
const HYGIENE_PER_EMPLOYEE = ["hygiene"];
const CLEANING = [
  "cleaning",
  "general_cleaning",
  "cleaning_ventilation_checklist",
  "uv_lamp_runtime",
  "disinfectant_usage",
  "sanitary_day_control",
  "pest_control",
];
const TEMPERATURE = [
  "climate_control",
  "cold_equipment_control",
  "intensive_cooling",
];
const PRODUCTION = [
  "finished_product",
  "perishable_rejection",
  "incoming_control",
  "incoming_raw_materials_control",
  "fryer_oil",
  "product_writeoff",
  "metal_impurity",
  "traceability_test",
  "equipment_cleaning",
];
const EQUIPMENT = [
  "equipment_maintenance",
  "breakdown_history",
  "equipment_calibration",
  "glass_items_list",
  "glass_control",
];
const PEOPLE = [
  "med_books",
  "training_plan",
  "staff_training",
  "ppe_issuance",
];
const COMPLIANCE = [
  "audit_plan",
  "audit_protocol",
  "audit_report",
  "accident_journal",
  "complaint_register",
];

// Шаблон ресторана/кафе с детализированными должностями кухни и зала.
// Каждая должность = ровный набор journal codes для access.
// Когда в реальном кафе должность есть в обоих формах («Повар» или
// «Повар горячего цеха») — нужны обе строки, чтобы preset покрыл
// любой выбор именования.
const KITCHEN_PRODUCTION_FULL = [
  "finished_product",
  "perishable_rejection",
  "intensive_cooling",
  "fryer_oil",
  "cold_equipment_control",
  "climate_control",
];
const KITCHEN_PRODUCTION_LIGHT = [
  "finished_product",
  "perishable_rejection",
  "cold_equipment_control",
  "climate_control",
];

const RESTAURANT_PRESET: OrgTypePreset = {
  type: "restaurant",
  label: "Ресторан / кафе",
  positions: [
    {
      name: "Управляющий",
      category: "management",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        ...PEOPLE,
        ...COMPLIANCE,
        "complaint_register",
      ],
    },
    {
      name: "Шеф-повар",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        ...PRODUCTION,
        ...TEMPERATURE,
        "fryer_oil",
        "incoming_control",
        "incoming_raw_materials_control",
      ],
    },
    {
      name: "Су-шеф",
      category: "management",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...KITCHEN_PRODUCTION_FULL],
    },
    {
      name: "Технолог",
      category: "management",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        ...EQUIPMENT,
        "metal_impurity",
        "traceability_test",
      ],
    },
    {
      name: "Повар",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...KITCHEN_PRODUCTION_FULL],
    },
    {
      name: "Повар горячего цеха",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...KITCHEN_PRODUCTION_FULL],
    },
    {
      name: "Повар холодного цеха",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...KITCHEN_PRODUCTION_LIGHT],
    },
    {
      name: "Повар-кондитер",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...KITCHEN_PRODUCTION_LIGHT],
    },
    {
      name: "Пекарь",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        "finished_product",
        "perishable_rejection",
        "fryer_oil",
        "cold_equipment_control",
      ],
    },
    {
      name: "Мангальщик",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        "finished_product",
        "fryer_oil",
      ],
    },
    {
      name: "Стажёр",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE],
    },
    {
      name: "Официант",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, "complaint_register"],
    },
    {
      name: "Хостес",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, "complaint_register"],
    },
    {
      name: "Бармен",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE],
    },
    {
      name: "Бариста",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE],
    },
    {
      name: "Сомелье",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE],
    },
    {
      name: "Менеджер зала",
      category: "management",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, "complaint_register"],
    },
    {
      name: "Метрдотель",
      category: "management",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, "complaint_register"],
    },
    {
      name: "Администратор смены",
      category: "management",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, "complaint_register"],
    },
    {
      name: "Кладовщик",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        "incoming_control",
        "incoming_raw_materials_control",
      ],
    },
    {
      name: "Грузчик",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE],
    },
    {
      name: "Курьер",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE],
    },
    {
      name: "Посудомойщик",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        "cleaning",
        "equipment_cleaning",
      ],
    },
    {
      name: "Уборщик",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        ...CLEANING,
        "uv_lamp_runtime",
      ],
    },
  ],
};

const MEAT_PRESET: OrgTypePreset = {
  type: "meat",
  label: "Мясная продукция",
  positions: [
    {
      name: "Директор производства",
      category: "management",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        ...PEOPLE,
        ...COMPLIANCE,
      ],
    },
    {
      name: "Технолог",
      category: "management",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        ...PRODUCTION,
        ...TEMPERATURE,
        "metal_impurity",
        "traceability_test",
      ],
    },
    {
      name: "Оператор линии",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        "finished_product",
        "perishable_rejection",
        "metal_impurity",
        "cold_equipment_control",
        "intensive_cooling",
      ],
    },
    {
      name: "Кладовщик",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        "incoming_raw_materials_control",
        "incoming_control",
        "cold_equipment_control",
        "climate_control",
      ],
    },
    {
      name: "Уборщик",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...CLEANING],
    },
  ],
};

const DAIRY_PRESET: OrgTypePreset = {
  ...MEAT_PRESET,
  type: "dairy",
  label: "Молочная продукция",
};

const BAKERY_PRESET: OrgTypePreset = {
  type: "bakery",
  label: "Хлебобулочные изделия",
  positions: [
    {
      name: "Управляющий",
      category: "management",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...PEOPLE, ...COMPLIANCE],
    },
    {
      name: "Технолог",
      category: "management",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        ...PRODUCTION,
        "metal_impurity",
        "traceability_test",
      ],
    },
    {
      name: "Пекарь",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        "finished_product",
        "perishable_rejection",
        "fryer_oil",
        "cold_equipment_control",
        "climate_control",
      ],
    },
    {
      name: "Уборщик",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...CLEANING],
    },
  ],
};

const CONFECTIONERY_PRESET: OrgTypePreset = {
  ...BAKERY_PRESET,
  type: "confectionery",
  label: "Кондитерские изделия",
};

const OTHER_PRESET: OrgTypePreset = {
  type: "other",
  label: "Другое",
  positions: [
    {
      name: "Управляющий",
      category: "management",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...PEOPLE, ...COMPLIANCE],
    },
    {
      name: "Сотрудник",
      category: "staff",
      journalCodes: [
        ...HYGIENE_PER_EMPLOYEE,
        ...PRODUCTION,
        ...TEMPERATURE,
      ],
    },
    {
      name: "Уборщик",
      category: "staff",
      journalCodes: [...HYGIENE_PER_EMPLOYEE, ...CLEANING],
    },
  ],
};

const PRESETS: Record<OrgType, OrgTypePreset> = {
  restaurant: RESTAURANT_PRESET,
  meat: MEAT_PRESET,
  dairy: DAIRY_PRESET,
  bakery: BAKERY_PRESET,
  confectionery: CONFECTIONERY_PRESET,
  other: OTHER_PRESET,
};

export function getOnboardingPreset(type: string | null | undefined): OrgTypePreset {
  if (!type) return OTHER_PRESET;
  const normalized = type.toLowerCase().trim() as OrgType;
  return PRESETS[normalized] ?? OTHER_PRESET;
}

export function listOnboardingPresets(): OrgTypePreset[] {
  return Object.values(PRESETS);
}

/**
 * Какие журналы НЕ нужны для preset'а — всё, что отсутствует в любом из
 * positions[].journalCodes. Используется для заполнения
 * Organization.disabledJournalCodes при apply preset, чтобы новый клиент
 * не видел в /journals 35 нерелевантных карточек.
 */
export function computeDisabledJournalCodes(preset: OrgTypePreset): string[] {
  // Default-off журналы (здоровье) выключаем при любом пресете.
  if (preset.disabledJournalCodes && preset.disabledJournalCodes.length > 0) {
    return withDefaultOffCodes([...preset.disabledJournalCodes]);
  }
  const enabled = new Set<string>(
    preset.positions.flatMap((p) => p.journalCodes)
  );
  return withDefaultOffCodes(
    ALL_JOURNAL_CODES.filter((code) => !enabled.has(code))
  );
}

/**
 * Журналы, которые WeSetup сам создаёт документами на каждый месяц.
 * По умолчанию — все ежедневные «hygiene/cleaning/temperatures»
 * из preset'a, чтобы клиенту не пришлось их заводить руками каждый месяц.
 * Если preset.autoJournalCodes явно задан — берём оттуда.
 */
export function computeAutoJournalCodes(preset: OrgTypePreset): string[] {
  if (preset.autoJournalCodes && preset.autoJournalCodes.length > 0) {
    return [...preset.autoJournalCodes];
  }
  const enabled = new Set<string>(
    preset.positions.flatMap((p) => p.journalCodes)
  );
  // Ежедневные журналы — те, для которых имеет смысл «один документ на
  // месяц, заполняем каждый день». События (accidents, complaints,
  // breakdowns) НЕ авто-создаём.
  // health_check не автосоздаём: журнал здоровья выключен по умолчанию.
  const DAILY = [
    "hygiene",
    "cleaning",
    "general_cleaning",
    "cleaning_ventilation_checklist",
    "uv_lamp_runtime",
    "disinfectant_usage",
    "climate_control",
    "cold_equipment_control",
    "intensive_cooling",
    "fryer_oil",
  ];
  return DAILY.filter((c) => enabled.has(c));
}

/**
 * Демо-сотрудники для одной кнопки «заселить тестовых» — для онбординга
 * новой компании ИЛИ для разовой проверки flow. Используется в связке
 * с пресетом — должности должны существовать до того, как сотрудники
 * к ним привязываются.
 */
export interface PresetStaff {
  positionName: string;
  fullName: string;
  phone: string;
}

export function getDemoStaffForType(type: string | null | undefined): PresetStaff[] {
  const preset = getOnboardingPreset(type);
  // Базовый шаблон: для каждой должности создаём 1-3 сотрудника с
  // RU-нейтральными ФИО. Телефоны заведомо несуществующие (демо),
  // в формате +7990 — пользователь потом сможет заменить.
  const demo: PresetStaff[] = [];
  let phoneCounter = 1000;
  const nextPhone = () =>
    `+79900${String(phoneCounter++).padStart(6, "0")}`.slice(0, 12);

  const namesForRole: Record<string, string[]> = {
    "Управляющий": ["Анна Менеджерова"],
    "Директор производства": ["Дмитрий Производов"],
    "Технолог": ["Елена Технологова"],
    "Шеф-повар": ["Сергей Шефов"],
    "Повар": ["Иван Поваров", "Ольга Кашина"],
    "Пекарь": ["Илья Хлебников", "Мария Тестова"],
    "Оператор линии": ["Олег Линевой", "Артём Конвейеров"],
    "Кладовщик": ["Виктория Складова"],
    "Официант": ["Мария Чайкова", "Дарья Подносова"],
    "Уборщик": ["Виктор Чистов"],
    "Сотрудник": ["Алексей Универсалов"],
  };

  for (const pos of preset.positions) {
    const names = namesForRole[pos.name] ?? [`Сотрудник «${pos.name}»`];
    for (const fullName of names) {
      demo.push({ positionName: pos.name, fullName, phone: nextPhone() });
    }
  }
  return demo;
}
