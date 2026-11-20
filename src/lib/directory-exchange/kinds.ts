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
 * Состав переносимых полей (`FieldSet`): `account` — внутри аккаунта,
 * `foreign` — «между аккаунтами» (правило Р5), если он у сущности свой.
 */
type FieldSet = { readonly account: readonly string[]; readonly foreign?: readonly string[] };

/**
 * Переносимые поля по версиям отпечатка (Р8.0, 2026-11-20). Состав и порядок
 * полей входят в отпечаток, поэтому нынешний состав на месте не правится:
 * поле, добавленное без новой версии, сделало бы «изменёнными» все связанные
 * записи сразу, и запись одной организации перезаписала бы соседей.
 *
 * Новый состав — новая версия в конце списка сущности; прежние остаются как
 * есть. Версия видна в отпечатке (`v2:…`, `rowHash`), и при первом обмене
 * после выката связь прежней версии сверяется с записью по прежнему составу
 * (`rowHashLike`, `rebaseLinks` в plan.ts): совпало — правки не было, связь
 * переходит на новый отпечаток без правок у соседей; не совпало — запись
 * правили на самом деле, и правка расходится как обычно.
 * Версия 1 — составы до 2026-11-20; её отпечаток без метки версии.
 *
 * Поле можно только добавить: поля прежних версий остаются в нынешней, иначе
 * прежний отпечаток не посчитать из прочитанных полей (`rowHashLike` → null).
 */
export const ENTITY_FIELD_VERSIONS = {
  product: [
    {
      account: [
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
    },
  ],
  position: [
    { account: ["name"] },
    // v2 (Р8.2): коды журналов, к которым у должности есть доступ. Другой
    // компании — только название, как телефоны сотрудников.
    { account: ["name", "journals"], foreign: ["name"] },
  ],
  staff: [{ account: ["name", "phone", "weeklyDaysOff"], foreign: ["name"] }],
  building: [{ account: ["name", "address"] }],
  room: [
    { account: ["name", "kind", "sortOrder"] },
    // v2 (Р8.3): графики уборки и нормы климата — данные помещения, без
    // ссылок на записи организации, поэтому и другой компании. Ответственные
    // (уборщики, проверяющие, «кто заполняет») — люди своей организации, их нет.
    {
      account: [
        "name",
        "kind",
        "sortOrder",
        "currentScope",
        "generalScope",
        "currentDays",
        "generalDays",
        "currentScheduleType",
        "generalScheduleType",
        "currentMonthDays",
        "generalMonthDays",
        "detergent",
        "requirePhoto",
        "climateNorms",
      ],
    },
  ],
  area: [{ account: ["name", "description"] }],
  equipment: [{ account: ["name", "type", "serialNumber", "tempMin", "tempMax", "lampModel", "lampLifetimeHours"] }],
} as const satisfies Record<ExchangeEntity, readonly [FieldSet, ...FieldSet[]]>;

function fieldVersions(entity: ExchangeEntity): readonly FieldSet[] {
  return ENTITY_FIELD_VERSIONS[entity];
}

/** Нынешняя версия состава полей сущности (1 — без метки в отпечатке). */
export function currentFieldVersion(entity: ExchangeEntity): number {
  return fieldVersions(entity).length;
}

/** Состав полей версии `version`; null — такой версии этот код не знает. */
function fieldSetOf(entity: ExchangeEntity, version: number): FieldSet | null {
  return fieldVersions(entity)[version - 1] ?? null;
}

function latestFieldSet(entity: ExchangeEntity): FieldSet {
  return fieldSetOf(entity, currentFieldVersion(entity))!;
}

/** Нынешние переносимые поля сущности внутри аккаунта (последняя версия). */
export const ENTITY_FIELDS = Object.fromEntries(
  EXCHANGE_ENTITIES.map((entity) => [entity, latestFieldSet(entity).account]),
) as Record<ExchangeEntity, readonly string[]>;

/**
 * Состав полей (правило Р5 обмена между аккаунтами, 2026-11-19).
 *   • `account` — все участники списка из одного аккаунта: `ENTITY_FIELDS`;
 *   • `foreign` — среди участников списка есть организация другого аккаунта:
 *     у сотрудника остаются только ФИО и должность (должность — родитель
 *     записи), у должности — название без журналов. Телефон, выходные и
 *     журналы должности из аккаунта не уходят и не сравниваются.
 * У остальных сущностей состав один.
 */
export const EXCHANGE_SCOPES = ["account", "foreign"] as const;
export type ExchangeScope = (typeof EXCHANGE_SCOPES)[number];

/** Чем состав `foreign` отличается от `ENTITY_FIELDS` (нынешняя версия). */
export const FOREIGN_ENTITY_FIELDS = Object.fromEntries(
  EXCHANGE_ENTITIES.flatMap((entity) => {
    const foreign = latestFieldSet(entity).foreign;
    return foreign ? [[entity, foreign]] : [];
  }),
) as Partial<Record<ExchangeEntity, readonly string[]>>;

/**
 * Отпечаток в составе `foreign` помечен: по строке видно, в каком составе он
 * снят. Смена состава (в обмен вошла организация другого аккаунта или вышла
 * из него) — не правка записи, и по метке обмен отличает одно от другого
 * (`rebaseLinks` в plan.ts). Метка версии идёт после неё: `f:v2:…`.
 */
export const FOREIGN_HASH_PREFIX = "f:";
/** Метка версии состава: `v2:` (Р8.0). Версия 1 — без метки. */
const VERSION_TAG = /^v([1-9][0-9]*):/;

/** Состав, который действует у сущности: `foreign` — только там, где он свой. */
export function entityScope(entity: ExchangeEntity, scope: ExchangeScope = "account"): ExchangeScope {
  return scope === "foreign" && latestFieldSet(entity).foreign ? "foreign" : "account";
}

/** Переносимые поля сущности в этом составе. */
export function exchangedFields(entity: ExchangeEntity, scope: ExchangeScope = "account"): readonly string[] {
  const fields = latestFieldSet(entity);
  return entityScope(entity, scope) === "foreign" ? fields.foreign! : fields.account;
}

/**
 * Метки отпечатка: состав и версия (`f:` — «между аккаунтами», `vN:` —
 * версия состава). Отпечаток — шестнадцатеричная строка: ни `:`, ни `v` в
 * ней нет, метки не спутать с ним. Пустая строка (надгробие) — версия 1.
 */
export function hashTag(hash: string): { scope: ExchangeScope; version: number } {
  const foreign = hash.startsWith(FOREIGN_HASH_PREFIX);
  const match = VERSION_TAG.exec(foreign ? hash.slice(FOREIGN_HASH_PREFIX.length) : hash);
  return { scope: foreign ? "foreign" : "account", version: match ? Number(match[1]) : 1 };
}

/** В каком составе снят отпечаток связи. */
export function hashScope(entity: ExchangeEntity, hash: string): ExchangeScope {
  const tag = hashTag(hash);
  return tag.scope === "foreign" && fieldSetOf(entity, tag.version)?.foreign ? "foreign" : "account";
}

/** Отпечаток связи снят в нынешних версии и составе `scope`: его сравнивают с записью как есть. */
export function isCurrentHash(entity: ExchangeEntity, hash: string, scope: ExchangeScope = "account"): boolean {
  return hashTag(hash).version === currentFieldVersion(entity) && hashScope(entity, hash) === entityScope(entity, scope);
}

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
 *
 * `owner` — чья это запись (аккаунт организации); его передаёт обмен, в
 * котором участвует организация другого аккаунта. Тогда люди сопоставляются
 * по ФИО только внутри своего аккаунта: «Иванов Иван» одной компании и
 * «Иванов Иван» другой — разные люди, и связывать их нельзя. Должности,
 * объекты, цеха, оборудование и продукты совпадают по названию у всех.
 */
export function naturalKey(
  entity: ExchangeEntity,
  fields: ExchangeFields,
  parentGroupId: string | null = null,
  owner: string | null = null,
): string | null {
  const name = normalizeExchangeName(fields.name);
  if (!name) return null;
  const parent = ENTITY_PARENT[entity];
  if (parent?.required && !parentGroupId) return null;
  switch (entity) {
    case "product":
      return `${normalizeExchangeName(fields.kind) || "raw"}|${name}`;
    case "staff":
      return owner ? `${owner}|${name}` : name;
    case "position":
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

const EMPTY_VALUE = "~";

function canonicalValue(value: ExchangeFieldValue | undefined): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === "string") return value === "" ? EMPTY_VALUE : `s:${value}`;
  if (typeof value === "number") return Number.isFinite(value) ? `n:${value}` : EMPTY_VALUE;
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
    .map((key) => [key, canonicalValue(fields[key])] as const)
    // Пустое поле в отпечаток не входит — так оно равно отсутствующему.
    .filter(([, value]) => value !== EMPTY_VALUE)
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0001");
  return cyrb53(text, 0x9e3779b1) + cyrb53(text, 0x85ebca6b);
}

/**
 * Только переносимые поля сущности — лишние ключи отбрасываются. В составе
 * `foreign` телефона и выходных сотрудника и журналов должности в результате
 * нет вовсе.
 */
export function pickExchangeFields(
  entity: ExchangeEntity,
  source: ExchangeFields,
  scope: ExchangeScope = "account",
): ExchangeFields {
  const picked: ExchangeFields = {};
  for (const key of exchangedFields(entity, scope)) picked[key] = source[key] ?? null;
  return picked;
}

/** Отпечаток полей `keys` и группы родителя с метками состава и версии. */
function taggedHash(
  entity: ExchangeEntity,
  fields: ExchangeFields,
  parentGroupId: string | null,
  keys: readonly string[],
  scope: ExchangeScope,
  version: number,
): string {
  const picked: ExchangeFields = {};
  for (const key of keys) picked[key] = fields[key] ?? null;
  const hash = hashFields({ ...picked, "#parent": entity === "area" ? null : parentGroupId });
  // Внутри аккаунта и в версии 1 — без меток: у сущностей, чей состав не
  // менялся, отпечаток прежний.
  return `${scope === "foreign" ? FOREIGN_HASH_PREFIX : ""}${version > 1 ? `v${version}:` : ""}${hash}`;
}

/**
 * Отпечаток записи: переносимые поля (в составе `scope`, нынешней версии) и
 * группа родителя. Перенос оборудования в другой цех или сотрудника на другую
 * должность — тоже правка, которую получают остальные.
 *
 * У цеха родитель в отпечаток не входит: объект у него необязателен, и когда
 * список «Объекты» включают позже «Оборудования», группа объекта появляется
 * у всех цехов сразу — все они выглядели бы изменёнными, и цеха одной
 * организации переезжали бы на объекты другой. Цех остаётся там, где он есть.
 */
export function rowHash(
  entity: ExchangeEntity,
  fields: ExchangeFields,
  parentGroupId: string | null = null,
  scope: ExchangeScope = "account",
): string {
  const effective = entityScope(entity, scope);
  return taggedHash(entity, fields, parentGroupId, exchangedFields(entity, effective), effective, currentFieldVersion(entity));
}

/**
 * Отпечаток записи в тех версии и составе, в каких снят `linkHash` (Р8.0, Р5),
 * — из полей, прочитанных в составе `scope`. Так обмен отличает смену состава
 * полей от правки записи. null — посчитать нельзя: версия неизвестна
 * (отпечаток новее этого кода) или нужного поля среди прочитанных нет (полный
 * отпечаток сотрудника, когда в обмене другая компания и телефон не читается).
 */
export function rowHashLike(
  entity: ExchangeEntity,
  fields: ExchangeFields,
  parentGroupId: string | null,
  linkHash: string,
  scope: ExchangeScope = "account",
): string | null {
  const tag = hashTag(linkHash);
  const set = fieldSetOf(entity, tag.version);
  const keys = tag.scope === "foreign" ? set?.foreign : set?.account;
  if (!keys) return null;
  const readable = exchangedFields(entity, scope);
  if (!keys.every((key) => readable.includes(key))) return null;
  return taggedHash(entity, fields, parentGroupId, keys, tag.scope, tag.version);
}

/** Пустой счётчик по спискам — основа итогов и счётчиков окна. */
export function emptyKindRecord<T>(make: () => T): Record<ExchangeKind, T> {
  return { products: make(), staff: make(), objects: make(), equipment: make() };
}
