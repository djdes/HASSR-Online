/**
 * Шаблоны типов заведений (onboarding presets). Один клик — и
 * у организации настроены: должности, помещения, оборудование,
 * включённые журналы, дефолтные task-modes.
 *
 * Сотрудников и реальные phone-numbers admin создаёт сам потом.
 *
 * Используется в /settings/onboarding-template.
 */

export type OrgTemplateKind =
  | "stand"        // Прилавок без посадочных мест (минимальный)
  | "cafe-small"   // Кафе 30 мест
  | "restaurant"   // Ресторан 100+ мест
  | "school"       // Школьная столовая
  | "production"   // Пищевое производство
  | "medical"      // Медицинский центр (21.11.2026)
  | "hotel";       // Отель с завтраками (21.11.2026)

export type JobPositionSpec = {
  name: string;
  categoryKey: "management" | "staff";
  /** Если true — должность по дефолту получает seesAllTasks=true. */
  seesAllTasks?: boolean;
};

export type AreaSpec = {
  name: string;
  /** "kitchen" | "wash" | "storage" | "guest" | "bar" | "other". */
  kind: string;
};

export type EquipmentSpec = {
  name: string;
  /** Тип из справочника оборудования (`validators.ts`): refrigerator, freezer, fryer, uv_lamp, thermometer, scale, other. */
  type: string;
  tempMin?: number;
  tempMax?: number;
  /** Помещение, куда поставить (`customizeTemplate`); нет — в первое помещение. */
  areaName?: string;
};

export type OrgTemplate = {
  kind: OrgTemplateKind;
  label: string;
  description: string;
  emoji: string;
  /** Типичный размер штата. */
  staffSize: string;
  /** Должности (включая управление). */
  positions: JobPositionSpec[];
  /** Помещения которые надо завести. */
  areas: AreaSpec[];
  /** Оборудование. */
  equipment: EquipmentSpec[];
  /** Журналы которые ОБЯЗАТЕЛЬНЫ для этого типа (остальные останутся
   *  disabled). null = включить все. */
  enabledJournals: string[] | null;
};

const COMMON_KITCHEN: AreaSpec[] = [
  { name: "Горячий цех", kind: "kitchen" },
  { name: "Холодный цех", kind: "kitchen" },
  { name: "Мойка", kind: "wash" },
  { name: "Склад сухой", kind: "storage" },
  { name: "Холодильная камера", kind: "storage" },
];

const COMMON_FRIDGES: EquipmentSpec[] = [
  { name: "Холодильник №1 (мясо)", type: "refrigerator", tempMin: 0, tempMax: 4 },
  { name: "Холодильник №2 (молочка)", type: "refrigerator", tempMin: 0, tempMax: 6 },
  { name: "Холодильник №3 (овощи)", type: "refrigerator", tempMin: 0, tempMax: 6 },
  { name: "Морозильная камера", type: "freezer", tempMin: -25, tempMax: -18 },
];

export const ORG_TEMPLATES: OrgTemplate[] = [
  {
    kind: "stand",
    label: "Прилавок / точка без посадки",
    description:
      "Простой прилавок: выпечка, готовая еда на вынос. 2-4 сотрудника. Минимальный набор журналов.",
    emoji: "🛒",
    staffSize: "2-4 человека",
    positions: [
      { name: "Админ", categoryKey: "management", seesAllTasks: true },
      { name: "Заведующий", categoryKey: "management" },
      { name: "Продавец", categoryKey: "staff" },
    ],
    areas: [
      { name: "Прилавок", kind: "guest" },
      { name: "Подсобка", kind: "storage" },
      { name: "Холодильная зона", kind: "storage" },
    ],
    equipment: [
      { name: "Холодильник для готовой продукции", type: "refrigerator", tempMin: 2, tempMax: 6 },
      { name: "Витрина-холодильник", type: "refrigerator", tempMin: 2, tempMax: 6 },
    ],
    // health_check не включаем: журнал здоровья выключен по умолчанию
    // (см. health-check-default-off.ts).
    enabledJournals: [
      "hygiene",
      "med_books",
      "staff_training",
      "ppe_issuance",
      "incoming_control",
      "perishable_rejection",
      "cold_equipment_control",
      "climate_control",
      "cleaning",
      "general_cleaning",
      "cleaning_ventilation_checklist",
      "disinfectant_usage",
      "pest_control",
      "complaint_register",
      "accident_journal",
    ],
  },

  {
    kind: "cafe-small",
    label: "Кафе 30 мест",
    description:
      "Небольшое кафе с производством. 5-10 сотрудников. Полный набор журналов кроме узкоспециальных.",
    emoji: "☕",
    staffSize: "5-10 человек",
    positions: [
      { name: "Админ", categoryKey: "management", seesAllTasks: true },
      { name: "Управляющий", categoryKey: "management" },
      { name: "Шеф-повар", categoryKey: "management" },
      { name: "Повар", categoryKey: "staff" },
      { name: "Уборщица", categoryKey: "staff" },
      { name: "Товаровед", categoryKey: "staff" },
      { name: "Официант", categoryKey: "staff" },
      { name: "Бариста / бармен", categoryKey: "staff" },
    ],
    areas: [...COMMON_KITCHEN, { name: "Зал", kind: "guest" }, { name: "Бар", kind: "bar" }],
    equipment: [
      ...COMMON_FRIDGES,
      { name: "Фритюр", type: "fryer", tempMin: 0, tempMax: 200 },
      { name: "УФ-лампа кухня", type: "uv_lamp" },
    ],
    enabledJournals: null, // все
  },

  {
    kind: "restaurant",
    label: "Ресторан 100+ мест",
    description:
      "Полноценная кухня с расширенным меню. 15-30 сотрудников. ВСЕ журналы + аудиты.",
    emoji: "🍽️",
    staffSize: "15-30 человек",
    positions: [
      { name: "Админ", categoryKey: "management", seesAllTasks: true },
      { name: "Управляющий", categoryKey: "management" },
      { name: "Шеф-повар", categoryKey: "management" },
      { name: "Су-шеф", categoryKey: "management" },
      { name: "Технолог", categoryKey: "management" },
      { name: "Повар горячего цеха", categoryKey: "staff" },
      { name: "Повар холодного цеха", categoryKey: "staff" },
      { name: "Кондитер", categoryKey: "staff" },
      { name: "Уборщица", categoryKey: "staff" },
      { name: "Товаровед / кладовщик", categoryKey: "staff" },
      { name: "Мойщик посуды", categoryKey: "staff" },
      { name: "Официант", categoryKey: "staff" },
      { name: "Бармен", categoryKey: "staff" },
      { name: "Хостес", categoryKey: "staff" },
    ],
    areas: [
      ...COMMON_KITCHEN,
      { name: "Кондитерский цех", kind: "kitchen" },
      { name: "Цех нарезки", kind: "kitchen" },
      { name: "Зал", kind: "guest" },
      { name: "Бар", kind: "bar" },
      { name: "Туалет персонала", kind: "other" },
      { name: "Гардероб", kind: "other" },
    ],
    equipment: [
      ...COMMON_FRIDGES,
      { name: "Холодильник №4 (рыба)", type: "refrigerator", tempMin: -2, tempMax: 2 },
      { name: "Холодильник №5 (полуфабрикаты)", type: "refrigerator", tempMin: 0, tempMax: 6 },
      { name: "Морозильная камера №2", type: "freezer", tempMin: -25, tempMax: -18 },
      { name: "Фритюр горячего цеха", type: "fryer" },
      { name: "Фритюр пирожкового", type: "fryer" },
      { name: "УФ-лампа горячий цех", type: "uv_lamp" },
      { name: "УФ-лампа холодный цех", type: "uv_lamp" },
      { name: "УФ-лампа цех нарезки", type: "uv_lamp" },
      { name: "Термометр электронный №1", type: "thermometer" },
      { name: "Термометр электронный №2", type: "thermometer" },
    ],
    enabledJournals: null,
  },

  {
    kind: "school",
    label: "Школьная столовая / детский сад",
    description:
      "Детское питание — ужесточённые требования СанПиН 2.3/2.4.4282-26. Бракераж + витаминизация + контроль массы порций.",
    emoji: "🎒",
    staffSize: "5-15 человек",
    positions: [
      { name: "Админ", categoryKey: "management", seesAllTasks: true },
      { name: "Заведующий производством", categoryKey: "management" },
      { name: "Шеф-повар", categoryKey: "management" },
      { name: "Технолог детского питания", categoryKey: "management" },
      { name: "Повар", categoryKey: "staff" },
      { name: "Кухонный работник", categoryKey: "staff" },
      { name: "Уборщица пищеблока", categoryKey: "staff" },
      { name: "Товаровед", categoryKey: "staff" },
      { name: "Раздатчик", categoryKey: "staff" },
    ],
    areas: [
      { name: "Горячий цех", kind: "kitchen" },
      { name: "Холодный цех", kind: "kitchen" },
      { name: "Цех первичной обработки овощей", kind: "kitchen" },
      { name: "Мясо-рыбный цех", kind: "kitchen" },
      { name: "Кондитерский цех", kind: "kitchen" },
      { name: "Раздаточная", kind: "guest" },
      { name: "Обеденный зал", kind: "guest" },
      { name: "Мойка столовой посуды", kind: "wash" },
      { name: "Мойка кухонной посуды", kind: "wash" },
      { name: "Склад сухой", kind: "storage" },
      { name: "Холодильная камера", kind: "storage" },
    ],
    equipment: COMMON_FRIDGES,
    // Школа = все обязательные + витаминизация
    enabledJournals: null,
  },

  {
    kind: "production",
    label: "Пищевое производство",
    description:
      "Промышленная переработка. ХАССП + traceability + металлопримеси + аудиты обязательны.",
    emoji: "🏭",
    staffSize: "20+ человек",
    positions: [
      { name: "Админ", categoryKey: "management", seesAllTasks: true },
      { name: "Директор по производству", categoryKey: "management" },
      { name: "Технолог-аудитор", categoryKey: "management" },
      { name: "Главный технолог", categoryKey: "management" },
      { name: "Мастер смены", categoryKey: "management" },
      { name: "Оператор линии", categoryKey: "staff" },
      { name: "Повар-технолог", categoryKey: "staff" },
      { name: "Контролёр качества", categoryKey: "staff" },
      { name: "Кладовщик", categoryKey: "staff" },
      { name: "Уборщица производства", categoryKey: "staff" },
      { name: "Слесарь / инженер", categoryKey: "staff" },
    ],
    areas: [
      { name: "Цех приёмки сырья", kind: "kitchen" },
      { name: "Цех первичной обработки", kind: "kitchen" },
      { name: "Производственный цех", kind: "kitchen" },
      { name: "Цех упаковки", kind: "kitchen" },
      { name: "Лаборатория", kind: "other" },
      { name: "Склад готовой продукции", kind: "storage" },
      { name: "Камера хранения сырья", kind: "storage" },
      { name: "Морозильная камера", kind: "storage" },
      { name: "Зона отгрузки", kind: "other" },
    ],
    equipment: [
      ...COMMON_FRIDGES,
      { name: "Камера интенсивного охлаждения", type: "refrigerator", tempMin: -2, tempMax: 2 },
      { name: "Промышленная морозильная камера", type: "freezer", tempMin: -25, tempMax: -18 },
      { name: "Магнитоулавливатель линии 1", type: "other" },
      { name: "Металлодетектор", type: "other" },
      { name: "Весы платформенные 100 кг", type: "scale" },
      { name: "Термометр-щуп №1", type: "thermometer" },
      { name: "Термометр-щуп №2", type: "thermometer" },
    ],
    enabledJournals: null,
  },

  {
    kind: "medical",
    label: "Медицинский центр / клиника",
    description:
      "Процедурные и стерилизация: УФ-облучатели, дезсредства, стерилизация инструментов, отходы класса Б, холодильник для лекарств.",
    emoji: "🩺",
    staffSize: "5-20 человек",
    positions: [
      { name: "Админ", categoryKey: "management", seesAllTasks: true },
      { name: "Главный врач", categoryKey: "management" },
      { name: "Старшая медсестра", categoryKey: "management" },
      { name: "Врач", categoryKey: "staff" },
      { name: "Медсестра", categoryKey: "staff" },
      { name: "Санитарка", categoryKey: "staff" },
      { name: "Администратор", categoryKey: "staff" },
    ],
    areas: [
      { name: "Процедурный кабинет", kind: "other" },
      { name: "Стерилизационная", kind: "other" },
      { name: "Кабинет приёма", kind: "other" },
      { name: "Холл и регистратура", kind: "guest" },
      { name: "Комната временного хранения отходов", kind: "other" },
      { name: "Склад", kind: "storage" },
      { name: "Санузел", kind: "other" },
    ],
    equipment: [
      { name: "Холодильник для лекарств", type: "refrigerator", tempMin: 2, tempMax: 8 },
      { name: "УФ-облучатель процедурного кабинета", type: "uv_lamp" },
      { name: "УФ-облучатель стерилизационной", type: "uv_lamp" },
      { name: "Термометр холодильника для лекарств", type: "thermometer" },
    ],
    enabledJournals: [
      "uv_lamp_runtime",
      "disinfectant_usage",
      "instrument_sterilization",
      "medical_waste_b",
      "cleaning",
      "general_cleaning",
      "cleaning_ventilation_checklist",
      "cold_equipment_control",
      "climate_control",
      "med_books",
      "staff_training",
      "training_plan",
      "ppe_issuance",
      "pest_control",
      "equipment_maintenance",
      "breakdown_history",
      "equipment_calibration",
      "accident_journal",
      "complaint_register",
    ],
  },

  {
    kind: "hotel",
    label: "Отель с завтраками",
    description:
      "Кухня завтраков и ресторан, номерной фонд, прачечная, бассейн — журналы пищеблока, уборки и воды бассейна.",
    emoji: "🏨",
    staffSize: "10-40 человек",
    positions: [
      { name: "Админ", categoryKey: "management", seesAllTasks: true },
      { name: "Управляющий", categoryKey: "management" },
      { name: "Шеф-повар", categoryKey: "management" },
      { name: "Повар", categoryKey: "staff" },
      { name: "Официант", categoryKey: "staff" },
      { name: "Горничная", categoryKey: "staff" },
      { name: "Кастелянша", categoryKey: "staff" },
      { name: "Техник", categoryKey: "staff" },
    ],
    areas: [
      { name: "Горячий цех", kind: "kitchen" },
      { name: "Холодный цех", kind: "kitchen" },
      { name: "Мойка", kind: "wash" },
      { name: "Склад сухой", kind: "storage" },
      { name: "Холодильная камера", kind: "storage" },
      { name: "Зал завтраков", kind: "guest" },
      { name: "Номерной фонд", kind: "other" },
      { name: "Прачечная", kind: "other" },
    ],
    equipment: [
      ...COMMON_FRIDGES,
      { name: "УФ-лампа кухня", type: "uv_lamp" },
    ],
    enabledJournals: [
      "hygiene",
      "med_books",
      "staff_training",
      "ppe_issuance",
      "incoming_control",
      "perishable_rejection",
      "finished_product",
      "daily_samples",
      "product_writeoff",
      "cold_equipment_control",
      "climate_control",
      "uv_lamp_runtime",
      "cleaning",
      "general_cleaning",
      "cleaning_ventilation_checklist",
      "disinfectant_usage",
      "pest_control",
      "equipment_maintenance",
      "breakdown_history",
      "accident_journal",
      "complaint_register",
    ],
  },
];

export function getOrgTemplate(kind: string): OrgTemplate | null {
  return ORG_TEMPLATES.find((t) => t.kind === kind) ?? null;
}

// ─── Настройка за 3 минуты (21.11.2026) ────────────────────────────────────
// Вид деятельности + пять ответов → шаблон под это заведение: столько
// холодильников, сколько есть, только нужные помещения, оборудование — в
// подходящие помещения, журналы — по ответам. Чистые функции: их же считает
// мастер для итога «будет создано», и тот же результат применяет API.

export type QuickSetupAnswers = {
  fridges: number;
  freezers: number;
  uvLamps: number;
  fryer: boolean;
  /** Названия помещений — из шаблона и каталога `ZONE_CATALOG`. */
  zones: string[];
};

export const QUICK_SETUP_LIMITS = { fridges: 30, freezers: 15, uvLamps: 20, zones: 30 } as const;

/** Каталог помещений, которые можно добавить к шаблону. */
export const ZONE_CATALOG: readonly AreaSpec[] = [
  { name: "Горячий цех", kind: "kitchen" },
  { name: "Холодный цех", kind: "kitchen" },
  { name: "Кондитерский цех", kind: "kitchen" },
  { name: "Мясо-рыбный цех", kind: "kitchen" },
  { name: "Цех первичной обработки овощей", kind: "kitchen" },
  { name: "Цех нарезки", kind: "kitchen" },
  { name: "Мойка", kind: "wash" },
  { name: "Склад сухой", kind: "storage" },
  { name: "Холодильная камера", kind: "storage" },
  { name: "Морозильная камера", kind: "storage" },
  { name: "Зал", kind: "guest" },
  { name: "Бар", kind: "bar" },
  { name: "Раздаточная", kind: "guest" },
  { name: "Туалет персонала", kind: "other" },
  { name: "Гардероб", kind: "other" },
  { name: "Бассейн", kind: "other" },
  { name: "Прачечная", kind: "other" },
  { name: "Лаборатория", kind: "other" },
  { name: "Процедурный кабинет", kind: "other" },
  { name: "Стерилизационная", kind: "other" },
  { name: "Комната временного хранения отходов", kind: "other" },
];

/** Что ещё предложить к помещениям шаблона — по виду. */
export const ZONE_SUGGESTIONS: Record<OrgTemplateKind, readonly string[]> = {
  stand: ["Мойка", "Склад сухой", "Туалет персонала"],
  "cafe-small": ["Кондитерский цех", "Мясо-рыбный цех", "Туалет персонала", "Гардероб"],
  restaurant: ["Мясо-рыбный цех", "Цех первичной обработки овощей", "Морозильная камера"],
  school: ["Туалет персонала", "Гардероб"],
  production: ["Мойка", "Туалет персонала", "Гардероб"],
  medical: ["Лаборатория"],
  hotel: ["Бассейн", "Бар", "Кондитерский цех", "Гардероб"],
};

/** Помещение включает свой журнал: есть — включить, нет — выключить. */
export const ZONE_JOURNALS: Readonly<Record<string, string>> = {
  "Бассейн": "pool_water_control",
  "Стерилизационная": "instrument_sterilization",
  "Комната временного хранения отходов": "medical_waste_b",
};

const COLD_TYPES = new Set(["refrigerator", "freezer"]);

function countOf(template: OrgTemplate, type: string): number {
  return template.equipment.filter((item) => item.type === type).length;
}

/** Ответы по умолчанию — как в шаблоне. */
export function defaultQuickSetupAnswers(template: OrgTemplate): QuickSetupAnswers {
  return {
    fridges: countOf(template, "refrigerator"),
    freezers: countOf(template, "freezer"),
    uvLamps: countOf(template, "uv_lamp"),
    fryer: countOf(template, "fryer") > 0,
    zones: template.areas.map((area) => area.name),
  };
}

/** Все помещения, которые можно отметить для этого шаблона. */
export function zoneOptions(template: OrgTemplate): AreaSpec[] {
  const names = new Set(template.areas.map((area) => area.name));
  const extras = (ZONE_SUGGESTIONS[template.kind] ?? [])
    .filter((name) => !names.has(name))
    .map((name) => ZONE_CATALOG.find((zone) => zone.name === name))
    .filter((zone): zone is AreaSpec => Boolean(zone));
  return [...template.areas, ...extras];
}

/** Помещения, которые API примет для этого шаблона: шаблон + весь каталог. */
export function isKnownZone(template: OrgTemplate, name: string): boolean {
  return template.areas.some((area) => area.name === name) || ZONE_CATALOG.some((zone) => zone.name === name);
}

function clampCount(value: number, max: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.trunc(value))) : 0;
}

function numbered(existing: EquipmentSpec[], count: number, make: (index: number) => EquipmentSpec): EquipmentSpec[] {
  const kept = existing.slice(0, count);
  for (let index = kept.length + 1; index <= count; index += 1) kept.push(make(index));
  return kept;
}

/** Куда поставить оборудование: холод — на склад/в камеру, УФ — в цеха и кабинеты по кругу, фритюр — в горячий цех. */
function placeEquipment(equipment: EquipmentSpec[], areas: AreaSpec[]): EquipmentSpec[] {
  if (areas.length === 0) return equipment;
  const kitchens = areas.filter((area) => area.kind === "kitchen");
  const storage = areas.filter((area) => area.kind === "storage");
  const coldRoom = storage.find((area) => /холодил|морозил|камер/i.test(area.name)) ?? storage[0] ?? kitchens[0] ?? areas[0];
  const workRooms = kitchens.length > 0 ? kitchens : areas.filter((area) => area.kind === "other" || area.kind === "wash");
  const uvRooms = workRooms.length > 0 ? workRooms : areas;
  const hot = kitchens.find((area) => /горяч/i.test(area.name)) ?? kitchens[0] ?? areas[0];
  let uvIndex = 0;
  return equipment.map((item) => {
    if (COLD_TYPES.has(item.type)) return { ...item, areaName: coldRoom.name };
    if (item.type === "uv_lamp") {
      const room = uvRooms[uvIndex % uvRooms.length];
      uvIndex += 1;
      return { ...item, areaName: room.name };
    }
    if (item.type === "fryer") return { ...item, areaName: hot.name };
    return { ...item, areaName: (kitchens[0] ?? areas[0]).name };
  });
}

export type QuickSetupPlan = {
  template: OrgTemplate;
  /** Журналы, которые ответы включают. */
  enable: string[];
  /** Журналы, которые ответы выключают. */
  disable: string[];
};

/**
 * Шаблон под ответы. Без ответов — шаблон как есть (оборудование только
 * расставлено по помещениям, журналы не трогаем).
 */
export function customizeTemplate(template: OrgTemplate, answers?: QuickSetupAnswers | null): QuickSetupPlan {
  if (!answers) {
    return { template: { ...template, equipment: placeEquipment(template.equipment, template.areas) }, enable: [], disable: [] };
  }
  const fridges = clampCount(answers.fridges, QUICK_SETUP_LIMITS.fridges);
  const freezers = clampCount(answers.freezers, QUICK_SETUP_LIMITS.freezers);
  const uvLamps = clampCount(answers.uvLamps, QUICK_SETUP_LIMITS.uvLamps);
  const options = zoneOptions(template);
  const picked = Array.from(new Set(answers.zones)).filter((name) => isKnownZone(template, name)).slice(0, QUICK_SETUP_LIMITS.zones);
  const areas = picked.map((name) => options.find((zone) => zone.name === name) ?? ZONE_CATALOG.find((zone) => zone.name === name)!);

  const ofType = (type: string) => template.equipment.filter((item) => item.type === type);
  const fryers = answers.fryer ? (ofType("fryer").length ? ofType("fryer") : [{ name: "Фритюр", type: "fryer" }]) : [];
  const others = template.equipment.filter((item) => !["refrigerator", "freezer", "uv_lamp", "fryer"].includes(item.type));
  const equipment = [
    ...numbered(ofType("refrigerator"), fridges, (index) => ({ name: `Холодильник №${index}`, type: "refrigerator", tempMin: 2, tempMax: 6 })),
    ...numbered(ofType("freezer"), freezers, (index) => ({ name: `Морозильник №${index}`, type: "freezer", tempMin: -25, tempMax: -18 })),
    ...numbered(ofType("uv_lamp"), uvLamps, (index) => ({ name: `УФ-лампа №${index}`, type: "uv_lamp" })),
    ...fryers,
    ...others,
  ];

  const enable: string[] = [];
  const disable: string[] = [];
  const toggle = (code: string, on: boolean) => (on ? enable : disable).push(code);
  toggle("fryer_oil", answers.fryer);
  toggle("uv_lamp_runtime", uvLamps > 0);
  toggle("cold_equipment_control", fridges + freezers > 0);
  for (const [zone, code] of Object.entries(ZONE_JOURNALS)) toggle(code, picked.includes(zone));

  let enabledJournals = template.enabledJournals;
  if (enabledJournals !== null) {
    const set = new Set(enabledJournals);
    for (const code of enable) set.add(code);
    for (const code of disable) set.delete(code);
    enabledJournals = [...set];
  }
  return { template: { ...template, areas, equipment: placeEquipment(equipment, areas), enabledJournals }, enable, disable };
}

/**
 * Какие журналы выключить после настройки. Шаблон с явным набором — всё вне
 * набора; шаблон «все журналы» — текущий выбор организации с поправками
 * ответов (ручные тумблеры и набор по сфере не затираем).
 */
export function plannedDisabledJournals(plan: QuickSetupPlan, allCodes: readonly string[], currentDisabled: readonly string[]): string[] | null {
  if (plan.template.enabledJournals !== null) {
    const enabled = new Set(plan.template.enabledJournals);
    return allCodes.filter((code) => !enabled.has(code));
  }
  if (plan.enable.length === 0 && plan.disable.length === 0) return null;
  const known = new Set(allCodes);
  const disabled = new Set(currentDisabled);
  for (const code of plan.disable) if (known.has(code)) disabled.add(code);
  for (const code of plan.enable) disabled.delete(code);
  return allCodes.filter((code) => disabled.has(code));
}
