/**
 * Наборы журналов раздела «Журналы» (эскиз руководителя, скан 82, лист 1:
 * «Журналы в соответствии с принципами ХАССП и СанПиН»).
 *
 * - `standard` — «Стандартный набор журналов»: 11 пунктов эскиза в его
 *   порядке. Это минимум, который мы советуем вести любому общепиту; его
 *   включаем новым организациям общепита (`defaultDisabledCodesFor`) и по
 *   нему считаем «Готовность» (`compliance-audit.ts`).
 * - `haccp` — «Набор в соответствии с HACCP»: журналы с флагом ХАССП
 *   (`JournalTemplate.isMandatoryHaccp`) и мониторинг ККТ.
 * - `extra` — «Доп. журналы»: весь остальной каталог. Вычисляется, чтобы
 *   новый журнал каталога не потерялся ни в одном наборе.
 *
 * Модуль чистый (без БД): его используют API, регистрация, «Готовность»
 * и тесты.
 */
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";

export const JOURNAL_SET_IDS = ["standard", "haccp", "extra"] as const;
export type JournalSetId = (typeof JOURNAL_SET_IDS)[number];

export type JournalSetItem = {
  /** Журнал, который набор включает и по которому считается «Готовность». */
  code: string;
  /**
   * Журналы того же пункта, которые набор НЕ включает сам. Сейчас один:
   * журнал здоровья (`health_check`) — дубль гигиенического, по решению
   * владельца выключен по умолчанию (см. health-check-default-off.ts).
   */
  related?: readonly string[];
};

export type JournalSet = {
  id: JournalSetId;
  title: string;
  description: string;
  items: readonly JournalSetItem[];
  /** Можно ли включить весь набор одной кнопкой. */
  bulkEnable: boolean;
};

/** 11 пунктов эскиза — в его порядке. */
const STANDARD_ITEMS: readonly JournalSetItem[] = [
  { code: "finished_product" },
  { code: "perishable_rejection" },
  { code: "hygiene", related: ["health_check"] },
  { code: "climate_control" },
  { code: "cold_equipment_control" },
  { code: "uv_lamp_runtime" },
  { code: "general_cleaning" },
  { code: "disinfectant_usage" },
  { code: "pest_control" },
  { code: "med_books" },
  // 11-й пункт эскиза — «прохождение инструктажа по принципам ХАССП»:
  // тема «Принципы ХАССП» в журнале инструктажей.
  { code: "staff_training" },
];

/**
 * Журналы с флагом ХАССП (как в сиде шаблонов) + мониторинг ККТ — в
 * порядке каталога.
 */
const HACCP_CODES = [
  "climate_control",
  "cold_equipment_control",
  "incoming_control",
  "training_plan",
  "breakdown_history",
  "equipment_maintenance",
  "incoming_raw_materials_control",
  "accident_journal",
  "complaint_register",
  "audit_plan",
  "audit_protocol",
  "audit_report",
  "traceability_test",
  "intensive_cooling",
  "glass_items_list",
  "transport_temperature",
  "inventory_condition",
  "batch_release",
  "ccp_monitoring",
] as const;

const catalogOrder = new Map<string, number>(ACTIVE_JOURNAL_CATALOG.map((item, index) => [item.code, index]));
const byCatalogOrder = (a: string, b: string) => (catalogOrder.get(a) ?? 0) - (catalogOrder.get(b) ?? 0);

/** Все коды пунктов набора: основные и связанные. */
export function journalSetAllCodes(set: Pick<JournalSet, "items">): string[] {
  return set.items.flatMap((item) => [item.code, ...(item.related ?? [])]);
}

const HACCP_ITEMS: readonly JournalSetItem[] = [...HACCP_CODES].sort(byCatalogOrder).map((code) => ({ code }));

const coveredBySets = new Set<string>([
  ...journalSetAllCodes({ items: STANDARD_ITEMS }),
  ...HACCP_CODES,
]);
const EXTRA_ITEMS: readonly JournalSetItem[] = ACTIVE_JOURNAL_CATALOG.filter((item) => !coveredBySets.has(item.code)).map(
  (item) => ({ code: item.code }),
);

export const JOURNAL_SETS: Record<JournalSetId, JournalSet> = {
  standard: {
    id: "standard",
    title: "Стандартный набор журналов",
    description:
      "11 журналов, которые нужны любому общепиту по СанПиН: бракеражи, гигиена сотрудников, температура, УФ-лампы, уборки, дезсредства, дезинсекция, медкнижки и инструктажи.",
    items: STANDARD_ITEMS,
    bulkEnable: true,
  },
  haccp: {
    id: "haccp",
    title: "Набор в соответствии с ХАССП",
    description:
      "Журналы с отметкой ХАССП и мониторинг критических контрольных точек — записи, которых требует ТР ТС 021/2011 (ст. 10) от системы ХАССП.",
    items: HACCP_ITEMS,
    bulkEnable: true,
  },
  extra: {
    id: "extra",
    title: "Дополнительные журналы",
    description: "Остальные журналы каталога: включайте те, что нужны вашему заведению.",
    items: EXTRA_ITEMS,
    // «Включить всё остальное» смысла не имеет: бассейн, отходы класса Б и
    // стерилизация инструментов нужны далеко не всем.
    bulkEnable: false,
  },
};

export function isJournalSetId(value: unknown): value is JournalSetId {
  return typeof value === "string" && (JOURNAL_SET_IDS as readonly string[]).includes(value);
}

/** Основные коды набора — то, что включает «Включить весь набор». */
export function journalSetCodes(id: JournalSetId): string[] {
  return JOURNAL_SETS[id].items.map((item) => item.code);
}

/** Основные коды стандартного набора (11). */
export const STANDARD_JOURNAL_CODES: readonly string[] = journalSetCodes("standard");

/**
 * «Включить весь набор»: убирает основные коды набора из списка
 * выключенных. Дельта — чужие выключенные журналы не трогаем; повторный
 * вызов ничего не меняет (`enabled` пуст).
 */
export function enableJournalSetCodes(
  disabledCodes: Iterable<string>,
  id: JournalSetId,
): { disabledCodes: string[]; enabled: string[] } {
  const current = [...new Set(disabledCodes)];
  const target = new Set(journalSetCodes(id));
  return {
    disabledCodes: current.filter((code) => !target.has(code)),
    enabled: current.filter((code) => target.has(code)),
  };
}

export type JournalSetItemStatus = JournalSetItem & { enabled: boolean };

/** Пункты набора с признаком «включён» для организации. */
export function journalSetStatus(id: JournalSetId, disabledCodes: ReadonlySet<string>): JournalSetItemStatus[] {
  return JOURNAL_SETS[id].items.map((item) => ({ ...item, enabled: !disabledCodes.has(item.code) }));
}
