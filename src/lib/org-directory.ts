/**
 * Общий справочник организации — один источник наименований для всех
 * журналов.
 *
 * Зачем: справочник продуктов (`/settings/products`, импорт из Excel,
 * iiko и 1С) подставлялся только ОДИН раз — при создании документа. Всё,
 * что загружали потом, до журналов не доезжало, и каждый журнал заводил
 * свой список со своей загрузкой из файла. Здесь — общий читатель, из
 * которого любой журнал добирает позиции кнопкой «Из справочника
 * организации», не трогая свой список.
 *
 * Client-safe часть (типы, подписи, фильтр) отделена от загрузки из БД:
 * серверный `loadOrgDirectory` живёт в `org-directory-db.ts`.
 */

export const ORG_DIRECTORY_KINDS = ["product", "supplier", "manufacturer", "dish"] as const;
export type OrgDirectoryKind = (typeof ORG_DIRECTORY_KINDS)[number];

export const ORG_DIRECTORY_LABEL: Record<OrgDirectoryKind, string> = {
  product: "Продукты",
  supplier: "Поставщики",
  manufacturer: "Изготовители",
  dish: "Блюда и изделия",
};

/** Откуда берутся значения — показываем человеку, чтобы он понимал источник. */
export const ORG_DIRECTORY_SOURCE_HINT: Record<OrgDirectoryKind, string> = {
  product: "Настройки → Справочник продуктов (импорт из Excel, iiko, 1С)",
  supplier: "Поставщики из справочника продуктов и принятых партий",
  manufacturer: "Изготовители из справочника продуктов",
  dish: "Наименования, которые уже вписывали в журналы",
};

export function isOrgDirectoryKind(value: unknown): value is OrgDirectoryKind {
  return typeof value === "string" && (ORG_DIRECTORY_KINDS as readonly string[]).includes(value);
}

/**
 * Позиции справочника, которых ещё нет в списке журнала. Сравнение без
 * учёта регистра и лишних пробелов: «Молоко 3.2%» и «молоко 3.2%» — одно
 * и то же, второй раз добавлять не нужно.
 */
export function missingFromList(directory: string[], list: string[]): string[] {
  const have = new Set(list.map((item) => item.replace(/\s+/g, " ").trim().toLowerCase()));
  return directory.filter((item) => !have.has(item.replace(/\s+/g, " ").trim().toLowerCase()));
}

/** Слияние списка журнала со справочником — без повторов, порядок сохраняется. */
export function mergeIntoList(list: string[], additions: string[]): string[] {
  const result = [...list];
  const have = new Set(list.map((item) => item.replace(/\s+/g, " ").trim().toLowerCase()));
  for (const item of additions) {
    const key = item.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || have.has(key)) continue;
    have.add(key);
    result.push(item);
  }
  return result;
}
