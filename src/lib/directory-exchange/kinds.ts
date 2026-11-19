/**
 * Обмен справочниками между организациями аккаунта (2026-11-19) — что именно
 * обменивается. Чистый модуль: списки, сущности, порядок зависимостей,
 * естественные ключи, переносимые поля и отпечаток записи.
 *
 * Список (`ExchangeKind`) — то, что отмечает владелец галочкой. Сущность
 * (`ExchangeEntity`) — таблица: у списка «Сотрудники» их две (должности и
 * люди), у «Объектов» — объекты и помещения, у «Оборудования» — цеха и
 * оборудование.
 *
 * Чего здесь нет намеренно (правило Р4): почты, пароля, Telegram, роли,
 * привязки датчиков, ответственных, комиссии и офиса — они не переносятся.
 */

export const EXCHANGE_KINDS = ["products", "staff", "objects", "equipment"] as const;
export type ExchangeKind = (typeof EXCHANGE_KINDS)[number];

export function isExchangeKind(value: unknown): value is ExchangeKind {
  return typeof value === "string" && (EXCHANGE_KINDS as readonly string[]).includes(value);
}

/** Списки без повторов и мусора, в порядке `EXCHANGE_KINDS`. */
export function normalizeExchangeKinds(raw: unknown): ExchangeKind[] {
  const given = new Set(Array.isArray(raw) ? raw.filter(isExchangeKind) : []);
  return EXCHANGE_KINDS.filter((kind) => given.has(kind));
}

/**
 * Сущности в порядке зависимостей: родитель всегда раньше потомка
 * (должность → сотрудник, объект → помещение, объект → цех → оборудование).
 * Цеха идут после помещений: помещение само заводит цех-зеркало, и к обмену
 * цехами оно уже есть — сопоставляется по ключу, а не создаётся вторым.
 */
export const EXCHANGE_ENTITIES = ["position", "staff", "building", "room", "area", "equipment", "product"] as const;
export type ExchangeEntity = (typeof EXCHANGE_ENTITIES)[number];

export function isExchangeEntity(value: unknown): value is ExchangeEntity {
  return typeof value === "string" && (EXCHANGE_ENTITIES as readonly string[]).includes(value);
}

export const KIND_ENTITIES: Record<ExchangeKind, readonly ExchangeEntity[]> = {
  products: ["product"],
  staff: ["position", "staff"],
  objects: ["building", "room"],
  equipment: ["area", "equipment"],
};

export const ENTITY_KIND: Record<ExchangeEntity, ExchangeKind> = {
  position: "staff",
  staff: "staff",
  building: "objects",
  room: "objects",
  area: "equipment",
  equipment: "equipment",
  product: "products",
};

/**
 * Родитель записи. `required` — без него запись не существует (сотрудник без
 * должности, помещение без объекта, оборудование без цеха); у цеха объект
 * необязателен и принадлежит другому списку («Объекты»).
 */
export const ENTITY_PARENT: Record<ExchangeEntity, { entity: ExchangeEntity; required: boolean } | null> = {
  position: null,
  staff: { entity: "position", required: true },
  building: null,
  room: { entity: "building", required: true },
  area: { entity: "building", required: false },
  equipment: { entity: "area", required: true },
  product: null,
};

/**
 * Переносимые поля. Состав и порядок входят в отпечаток: поменять список —
 * значит объявить изменёнными все связанные записи сразу.
 */
export const ENTITY_FIELDS = {
  product: [
    "name",
    "supplier",
    "barcode",
    "unit",
    "category",
    "kind",
    "storageTemp",
    "storageConditions",
    "shelfLifeDays",
    "shelfLifeHours",
    "servingTemp",
  ],
  position: ["name"],
  staff: ["name", "phone", "weeklyDaysOff"],
  building: ["name", "address"],
  room: ["name", "kind", "sortOrder"],
  area: ["name", "description"],
  equipment: ["name", "type", "serialNumber", "tempMin", "tempMax", "lampModel", "lampLifetimeHours"],
} as const satisfies Record<ExchangeEntity, readonly string[]>;

export type ExchangeFieldValue = string | number | boolean | null | readonly number[];
export type ExchangeFields = Record<string, ExchangeFieldValue | undefined>;

/** Имя в ключе: без крайних пробелов, пробелы свёрнуты, нижний регистр. */
export function normalizeExchangeName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : "";
}

/**
 * Естественный ключ записи — по нему запись без связи находит «свою» у
 * других участников. `parentGroupId` — группа родителя (объекта помещения,
 * цеха оборудования, должности сотрудника). null — запись не обменивается:
 * пустое имя или обязательный родитель сам не участвует в обмене.
 */
export function naturalKey(
  entity: ExchangeEntity,
  fields: ExchangeFields,
  parentGroupId: string | null = null,
): string | null {
  const name = normalizeExchangeName(fields.name);
  if (!name) return null;
  const parent = ENTITY_PARENT[entity];
  if (parent?.required && !parentGroupId) return null;
  switch (entity) {
    case "product":
      return `${normalizeExchangeName(fields.kind) || "raw"}|${name}`;
    case "position":
    case "staff":
    case "building":
      return name;
    case "room":
      return `${parentGroupId}|${name}`;
    case "area":
      return `${parentGroupId ?? "-"}|${name}`;
    case "equipment":
      return `${parentGroupId}|${normalizeExchangeName(fields.type)}|${name}`;
  }
}

function canonicalValue(value: ExchangeFieldValue | undefined): string {
  if (value === null || value === undefined) return "~";
  if (typeof value === "string") return value === "" ? "~" : `s:${value}`;
  if (typeof value === "number") return Number.isFinite(value) ? `n:${value}` : "~";
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  return `a:${[...value].sort((a, b) => a - b).join(",")}`;
}

// cyrb53 — быстрый несекретный хэш строки (53 бита). Без `node:crypto`:
// модуль чистый и годится для клиентского кода.
function cyrb53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/**
 * Отпечаток набора полей: не зависит от порядка ключей; пустая строка,
 * null и отсутствие поля — одно и то же. Одинаковое содержимое в разных
 * организациях даёт одинаковый отпечаток.
 */
export function hashFields(fields: ExchangeFields): string {
  const text = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${canonicalValue(fields[key])}`)
    .join("\u0001");
  return cyrb53(text, 0x9e3779b1) + cyrb53(text, 0x85ebca6b);
}

/** Только переносимые поля сущности — лишние ключи отбрасываются. */
export function pickExchangeFields(entity: ExchangeEntity, source: ExchangeFields): ExchangeFields {
  const picked: ExchangeFields = {};
  for (const key of ENTITY_FIELDS[entity]) picked[key] = source[key] ?? null;
  return picked;
}

/**
 * Отпечаток записи: переносимые поля и группа родителя. Перенос
 * оборудования в другой цех или сотрудника на другую должность — тоже
 * правка, которую получают остальные.
 */
export function rowHash(entity: ExchangeEntity, fields: ExchangeFields, parentGroupId: string | null = null): string {
  return hashFields({ ...pickExchangeFields(entity, fields), "#parent": parentGroupId });
}

/** Пустой счётчик по спискам — основа итогов и счётчиков окна. */
export function emptyKindRecord<T>(make: () => T): Record<ExchangeKind, T> {
  return { products: make(), staff: make(), objects: make(), equipment: make() };
}
