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
};

export const CURATED_CATEGORIES: readonly CuratedCategory[] = [
  {
    id: "journal-hygiene",
    group: "journals",
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
  { id: "navigation", group: "interface", prefixes: ["navigation", "rootNavigation"] },
  { id: "common", group: "interface", prefixes: ["common"] },
];

const OTHER_PREFIX = "ns:";

export type TranslationCategorySummary = {
  id: string;
  group: TranslationCategoryGroup;
  /** Для «Прочих» — имя пространства имён каталога. */
  namespace?: string;
  keys: string[];
};

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
    const namespace = key.split(".")[0];
    const list = other.get(namespace) ?? [];
    list.push(key);
    other.set(namespace, list);
  });
  return [
    ...curated.map(({ category, rows }) => ({
      id: category.id,
      group: category.group,
      keys: rows.sort((a, b) => a.prefix - b.prefix || a.order - b.order).map((row) => row.key),
    })),
    ...[...other.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([namespace, keys]) => ({ id: `${OTHER_PREFIX}${namespace}`, group: "other" as const, namespace, keys })),
  ];
}
