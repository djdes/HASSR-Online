import { pluralRu } from "./plural-ru";

export type JournalTariffId = "basic" | "extended";

export interface JournalCatalogItem {
  code: string;
  name: string;
}

export interface JournalTariffDefinition {
  id: JournalTariffId;
  name: string;
  subtitle?: string;
  journals: readonly JournalCatalogItem[];
  extraJournals?: readonly JournalCatalogItem[];
}

const BASIC_JOURNALS = [
  { code: "hygiene", name: "Гигиенический журнал (сотрудники)" },
  { code: "health_check", name: "Журнал здоровья" },
  { code: "climate_control", name: "Бланк контроля температуры и влажности на складах" },
  {
    code: "cold_equipment_control",
    name: "Журнал контроля температурного режима холодильного и морозильного оборудования",
  },
  {
    code: "cleaning_ventilation_checklist",
    name: "Чек-лист уборки и проветривания помещений",
  },
  { code: "cleaning", name: "Журнал уборки" },
  { code: "general_cleaning", name: "График и учет генеральных уборок" },
  {
    code: "uv_lamp_runtime",
    name: "Журнал учета работы УФ бактерицидной установки",
  },
  {
    code: "finished_product",
    name: "Журнал бракеража готовой пищевой продукции",
  },
  {
    code: "perishable_rejection",
    name: "Журнал бракеража скоропортящейся пищевой продукции",
  },
  {
    code: "incoming_control",
    name: "Журнал приемки и входного контроля продукции",
  },
  { code: "fryer_oil", name: "Журнал учета использования фритюрных жиров" },
  { code: "med_books", name: "Медицинские книжки" },
] as const satisfies readonly JournalCatalogItem[];

const EXTENDED_ONLY_JOURNALS = [
  { code: "training_plan", name: "План обучения персонала" },
  {
    code: "staff_training",
    name: "Журнал регистрации инструктажей (обучения) сотрудников",
  },
  { code: "disinfectant_usage", name: "Журнал учета дезинфицирующих средств" },
  {
    code: "sanitary_day_control",
    name: "Чек-лист (памятка) проведения санитарного дня",
  },
  {
    code: "equipment_maintenance",
    name: "График профилактического обслуживания оборудования",
  },
  { code: "breakdown_history", name: "Карточка истории поломок" },
  {
    code: "equipment_calibration",
    name: "График поверки средств измерений",
  },
  {
    code: "incoming_raw_materials_control",
    name: "Журнал входного контроля сырья, ингредиентов, упаковочных материалов",
  },
  { code: "ppe_issuance", name: "Журнал учета выдачи СИЗ" },
  { code: "accident_journal", name: "Журнал учета аварий" },
  { code: "complaint_register", name: "Журнал регистрации жалоб" },
  { code: "product_writeoff", name: "Акт забраковки" },
  { code: "audit_plan", name: "План-программа внутренних аудитов" },
  { code: "audit_protocol", name: "Протокол внутреннего аудита" },
  { code: "audit_report", name: "Отчет о внутреннем аудите" },
  { code: "traceability_test", name: "Журнал прослеживаемости продукции" },
  { code: "metal_impurity", name: "Журнал учета металлопримесей в сырье" },
  {
    code: "equipment_cleaning",
    name: "Журнал мойки и дезинфекции оборудования",
  },
  {
    code: "intensive_cooling",
    name: "Журнал контроля интенсивного охлаждения горячих блюд",
  },
  {
    code: "glass_items_list",
    name: "Перечень изделий из стекла и хрупкого пластика",
  },
  {
    code: "glass_control",
    name: "Журнал контроля изделий из стекла и хрупкого пластика",
  },
  {
    code: "pest_control",
    name: "Журнал учета дезинфекции, дезинсекции и дератизации",
  },
  // Сентябрь 2026: табличные реестры (register-journals.ts). Добавлены в
  // конец, чтобы не сдвигать sortOrder существующих шаблонов.
  { code: "daily_samples", name: "Журнал отбора и хранения суточных проб" },
  {
    code: "vitaminization",
    name: "Журнал проведения витаминизации третьих и сладких блюд",
  },
  { code: "ration_control", name: "Ведомость контроля за рационом питания" },
  {
    code: "transport_temperature",
    name: "Журнал контроля температуры при транспортировке",
  },
  { code: "tableware_breakage", name: "Журнал учёта боя посуды" },
  {
    code: "pool_water_control",
    name: "Журнал контроля качества воды в бассейне",
  },
] as const satisfies readonly JournalCatalogItem[];

export const BASIC_TARIFF_JOURNALS = BASIC_JOURNALS;
export const EXTENDED_ONLY_TARIFF_JOURNALS = EXTENDED_ONLY_JOURNALS;
export const ACTIVE_JOURNAL_CATALOG = [...BASIC_JOURNALS, ...EXTENDED_ONLY_JOURNALS] as const;

/**
 * Сколько журналов в каталоге. В текстах раньше было зашито конкретное число,
 * и число расходилось с каталогом после каждого нового журнала — теперь
 * все упоминания берут его отсюда (склонение — `journalsCountLabel`).
 */
export const JOURNALS_TOTAL = ACTIVE_JOURNAL_CATALOG.length;

/** «41 журнал», «42 журнала», «45 журналов» — для любого числа. */
export function journalsCountLabel(count: number = JOURNALS_TOTAL): string {
  return `${count} ${pluralRu(count, "журнал", "журнала", "журналов")}`;
}

/** Готовая подпись для текстов: «41 журнал». */
export const JOURNALS_TOTAL_LABEL = journalsCountLabel(JOURNALS_TOTAL);

/** «41 электронный журнал», «42 электронных журнала». */
export const JOURNALS_TOTAL_ELECTRONIC_LABEL = `${JOURNALS_TOTAL} ${pluralRu(
  JOURNALS_TOTAL,
  "электронный журнал",
  "электронных журнала",
  "электронных журналов"
)}`;

export const JOURNAL_TARIFFS: Record<JournalTariffId, JournalTariffDefinition> = {
  basic: {
    id: "basic",
    name: "Базовый",
    journals: BASIC_JOURNALS,
  },
  extended: {
    id: "extended",
    name: "Расширенный",
    subtitle: 'включая "Базовый"',
    journals: ACTIVE_JOURNAL_CATALOG,
    extraJournals: EXTENDED_ONLY_JOURNALS,
  },
};

export const ACTIVE_JOURNAL_TEMPLATES = ACTIVE_JOURNAL_CATALOG.map((item, index) => ({
  ...item,
  sortOrder: index + 1,
}));

export function formatJournalPreview(
  journals: readonly JournalCatalogItem[],
  visibleCount = 3
): string {
  const visible = journals.slice(0, visibleCount).map((item) => item.name);
  const hiddenCount = Math.max(journals.length - visible.length, 0);

  if (hiddenCount === 0) return visible.join(", ");
  if (visible.length === 0) return journalsCountLabel(journals.length);
  return `${visible.join(", ")} и еще ${hiddenCount}`;
}
