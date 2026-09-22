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
  | "production";  // Пищевое производство

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
  type: string; // "fridge" | "freezer" | "fryer" | "uv_lamp" | "thermometer"
  tempMin?: number;
  tempMax?: number;
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
  { name: "Холодильник №1 (мясо)", type: "fridge", tempMin: 0, tempMax: 4 },
  { name: "Холодильник №2 (молочка)", type: "fridge", tempMin: 0, tempMax: 6 },
  { name: "Холодильник №3 (овощи)", type: "fridge", tempMin: 0, tempMax: 6 },
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
      { name: "Заведующая", categoryKey: "management" },
      { name: "Продавец", categoryKey: "staff" },
    ],
    areas: [
      { name: "Прилавок", kind: "guest" },
      { name: "Подсобка", kind: "storage" },
      { name: "Холодильная зона", kind: "storage" },
    ],
    equipment: [
      { name: "Холодильник для готовой продукции", type: "fridge", tempMin: 2, tempMax: 6 },
      { name: "Витрина-холодильник", type: "fridge", tempMin: 2, tempMax: 6 },
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
      { name: "Холодильник №4 (рыба)", type: "fridge", tempMin: -2, tempMax: 2 },
      { name: "Холодильник №5 (полуфабрикаты)", type: "fridge", tempMin: 0, tempMax: 6 },
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
      { name: "Заведующая производством", categoryKey: "management" },
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
      { name: "Камера интенсивного охлаждения", type: "fridge", tempMin: -2, tempMax: 2 },
      { name: "Промышленная морозильная камера", type: "freezer", tempMin: -25, tempMax: -18 },
      { name: "Магнитоулавливатель линии 1", type: "thermometer" },
      { name: "Металлодетектор", type: "thermometer" },
      { name: "Весы платформенные 100 кг", type: "thermometer" },
      { name: "Термометр-щуп №1", type: "thermometer" },
      { name: "Термометр-щуп №2", type: "thermometer" },
    ],
    enabledJournals: null,
  },
];

export function getOrgTemplate(kind: string): OrgTemplate | null {
  return ORG_TEMPLATES.find((t) => t.kind === kind) ?? null;
}
