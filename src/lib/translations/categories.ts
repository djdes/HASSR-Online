import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";

/**
 * Категории редактора переводов. Курируемая категория — список префиксов
 * ключей каталога (журнал целиком: документ, поля, инструкции, печать,
 * уведомления). Всё, что ни в одну курируемую не попало, остаётся
 * доступным в «Прочих разделах» по пространству имён — так в редакторе
 * с первого дня есть каждая строка, а курируемые категории добавляются
 * по одной.
 */

export type TranslationCategoryGroup = "journals" | "interface" | "other";

export type CuratedCategory = {
  id: string;
  group: Exclude<TranslationCategoryGroup, "other">;
  prefixes: readonly string[];
  /** Ключ каталога, русское значение которого — название категории (журнал). */
  titleKey?: string;
};

/**
 * Журнал целиком: префиксы одного кода журнала по всем пространствам
 * каталога (+ собственные пространства журнала, если они есть).
 */
function journalCategory(code: string, extraPrefixes: readonly string[] = []): CuratedCategory {
  return {
    id: `journal-${code}`,
    group: "journals",
    titleKey: `journals.names.${code}`,
    prefixes: [
      `journals.names.${code}`,
      `journalDescriptions.${code}`,
      `journalInfoTaglines.${code}`,
      `journalWidgets.periodicity.${code}`,
      `journalFields.${code}`,
      `taskFillSchema.forms.${code}`,
      `taskFillSchema.fields.${code}`,
      `taskFillSchema.options.${code}`,
      `journalFillingGuides.${code}`,
      `journalDocGuides.${code}`,
      ...extraPrefixes,
    ],
  };
}

/** Пространства каталога, которыми пользуется ровно один журнал. */
const JOURNAL_OWN_NAMESPACES: Record<string, readonly string[]> = {
  climate_control: ["climate"],
  cold_equipment_control: ["coldEquipment"],
  uv_lamp_runtime: ["uvLampRuntime"],
  fryer_oil: ["fryerOil"],
  equipment_calibration: ["equipmentCalibration"],
  finished_product: ["finishedProduct"],
  perishable_rejection: ["perishableRejection"],
  accident_journal: ["accidentJournal"],
  breakdown_history: ["breakdownHistory"],
  complaint_register: ["complaintRegister"],
  glass_items_list: ["glassInventory"],
  cleaning: ["cleaningGrid.cleaning"],
};

/** Коды всех журналов каталога, кроме гигиенического (он ведётся отдельной категорией выше). */
const OTHER_JOURNAL_CODES = ACTIVE_JOURNAL_CATALOG.map((item) => item.code).filter((code) => code !== "hygiene");

export const CURATED_CATEGORIES: readonly CuratedCategory[] = [
  {
    id: "journal-hygiene",
    group: "journals",
    titleKey: "journals.names.hygiene",
    prefixes: [
      "journals.names.hygiene",
      "journalDescriptions.hygiene",
      "journalInfoTaglines.hygiene",
      "journalWidgets.periodicity.hygiene",
      "hygiene",
      "journalFields.hygiene",
      "taskFillSchema.forms.hygiene",
      "taskFillSchema.fields.hygiene",
      "taskFillSchema.options.hygiene",
      "taskFillSchema.dynamic.hygieneIntro",
      "taskFillSchema.dynamic.hygieneV2Intro",
      "journalFillingGuides.hygiene",
      "journalDocGuides.hygiene",
      "hygieneHealthPdf",
      "notifications.messages.hygieneAdmission",
      "notifications.messages.hygieneSigned",
      "notifications.messages.hygieneComplaints",
    ],
  },
  ...OTHER_JOURNAL_CODES.map((code) => journalCategory(code, JOURNAL_OWN_NAMESPACES[code] ?? [])),
  { id: "navigation", group: "interface", prefixes: ["navigation", "rootNavigation"] },
  { id: "common", group: "interface", prefixes: ["common"] },
];

const OTHER_PREFIX = "ns:";

export type TranslationCategorySummary = {
  id: string;
  group: TranslationCategoryGroup;
  titleKey?: string;
  /** Для «Прочих» — имя пространства имён каталога. */
  namespace?: string;
  keys: string[];
};

/**
 * Пространство «Прочих разделов». Большие «клиентские» пространства
 * (`journalUi`, `settingsUi`, …) делятся по компоненту: `journalUi.medBook`.
 */
function otherNamespace(key: string): string {
  const [head, second] = key.split(".");
  return /Ui$/.test(head) && second ? `${head}.${second}` : head;
}

function matchesPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}.`);
}

function curatedIndex(key: string): { category: number; prefix: number } | null {
  for (let category = 0; category < CURATED_CATEGORIES.length; category++) {
    const prefix = CURATED_CATEGORIES[category].prefixes.findIndex((item) => matchesPrefix(key, item));
    if (prefix >= 0) return { category, prefix };
  }
  return null;
}

/**
 * Раскладывает ключи каталога (в порядке файла) по категориям. Ключ
 * курируемой категории в «Прочие» не попадает; внутри курируемой —
 * порядок её префиксов, внутри префикса — порядок файла.
 */
export function buildCategories(catalogKeys: readonly string[]): TranslationCategorySummary[] {
  const curated = CURATED_CATEGORIES.map((category) => ({
    rows: [] as { key: string; prefix: number; order: number }[],
    category,
  }));
  const other = new Map<string, string[]>();
  catalogKeys.forEach((key, order) => {
    const hit = curatedIndex(key);
    if (hit) {
      curated[hit.category].rows.push({ key, prefix: hit.prefix, order });
      return;
    }
    const namespace = otherNamespace(key);
    const list = other.get(namespace) ?? [];
    list.push(key);
    other.set(namespace, list);
  });
  return [
    ...curated
      .filter(({ category, rows }) => rows.length > 0 || !category.id.startsWith("journal-"))
      .map(({ category, rows }) => ({
      id: category.id,
      group: category.group,
      titleKey: category.titleKey,
      keys: rows.sort((a, b) => a.prefix - b.prefix || a.order - b.order).map((row) => row.key),
    })),
    ...[...other.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([namespace, keys]) => ({ id: `${OTHER_PREFIX}${namespace}`, group: "other" as const, namespace, keys })),
  ];
}
