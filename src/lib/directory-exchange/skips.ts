/**
 * Разбор пропущенных записей обмена (серия B, пункт 9, правила Р9.1–Р9.3).
 * Чистый модуль: что записать в `DirectoryExchangeSkip` после прохода
 * сущности, какие записи получателя годятся для «Связать с …» и разбор
 * ответа `GET /api/settings/directory-exchange/skips` для окна «Разобрать».
 *
 * Обмен пропускает создание записи, когда у получателя нет мест в тарифе
 * (`limit`) или такое название уже занято (`conflict`). Строка разбора живёт,
 * пока запись у получателя не появилась, не связана и её не отказались
 * переносить («Не переносить» — надгробие в таблице соответствий).
 */

import {
  ENTITY_KIND,
  ENTITY_PARENT,
  EXCHANGE_ENTITIES,
  isExchangeEntity,
  normalizeExchangeName,
  type ExchangeEntity,
  type ExchangeKind,
} from "@/lib/directory-exchange/kinds";

export const SKIP_REASONS = ["limit", "conflict"] as const;
export type ExchangeSkipReason = (typeof SKIP_REASONS)[number];

export function isSkipReason(value: unknown): value is ExchangeSkipReason {
  return typeof value === "string" && (SKIP_REASONS as readonly string[]).includes(value);
}

/* ───────────────────────── запись строк разбора ───────────────────────── */

/** Пропуск создания: запись группы `groupId` не создана у `organizationId`. */
export type ExchangeSkipRecord = {
  groupId: string;
  organizationId: string;
  sourceOrganizationId: string;
  sourceEntityId: string;
  name: string;
  reason: ExchangeSkipReason;
};

/** Строка из базы: причина — как записана (неизвестная заменится при следующем пропуске). */
export type StoredExchangeSkip = Omit<ExchangeSkipRecord, "reason"> & { id: string; reason: string };

export type SkipSyncPlan = {
  /** Строки, которые больше не нужны: запись создана, связана, надгробие или группы больше нет. */
  remove: string[];
  /** Тот же пропуск, что и раньше: сдвинуть только `lastSeenAt`. */
  touch: string[];
  /** Тот же пропуск с другим названием, источником или причиной. */
  change: Array<{ id: string; record: ExchangeSkipRecord }>;
  /** Новые пропуски. */
  add: ExchangeSkipRecord[];
};

const skipKey = (groupId: string, organizationId: string) => `${groupId}\u0000${organizationId}`;

/**
 * Что сделать со строками разбора после прохода одной сущности. `stored` —
 * строки этого кабинета и сущности у участников прохода; `skipped` — пропуски
 * этого прохода; `groups` — группы, которые проход видел (связи и операции
 * плана). Строка группы, которую проход видел, но не пропустил, — уже не
 * пропуск: у получателя запись появилась, связалась, стала надгробием или
 * у группы не осталось записей. Строки групп, которых проход не видел
 * (участник другого аккаунта в предварительном проходе), не трогаются.
 */
export function planSkipSync(input: {
  stored: readonly StoredExchangeSkip[];
  skipped: readonly ExchangeSkipRecord[];
  groups: Iterable<string>;
}): SkipSyncPlan {
  const groups = new Set(input.groups);
  const current = new Map<string, ExchangeSkipRecord>();
  for (const record of input.skipped) current.set(skipKey(record.groupId, record.organizationId), record);
  const stored = new Map<string, StoredExchangeSkip>();
  for (const row of input.stored) {
    const key = skipKey(row.groupId, row.organizationId);
    if (!stored.has(key)) stored.set(key, row);
  }

  const plan: SkipSyncPlan = { remove: [], touch: [], change: [], add: [] };
  for (const row of input.stored) {
    const key = skipKey(row.groupId, row.organizationId);
    // Повтор строки (unique не даст, но и не должен ломать план) — лишний.
    if (stored.get(key) !== row) plan.remove.push(row.id);
    else if (!current.has(key) && groups.has(row.groupId)) plan.remove.push(row.id);
  }
  for (const [key, record] of current) {
    const row = stored.get(key);
    if (!row) {
      plan.add.push(record);
      continue;
    }
    const same =
      row.sourceOrganizationId === record.sourceOrganizationId &&
      row.sourceEntityId === record.sourceEntityId &&
      row.name === record.name &&
      row.reason === record.reason;
    if (same) plan.touch.push(row.id);
    else plan.change.push({ id: row.id, record });
  }
  return plan;
}

/* ───────────────────────── «Связать с …» ───────────────────────── */

/**
 * Сущности, у которых в обмене есть потомки (должность — сотрудники, объект —
 * помещения и цеха, цех — оборудование). Такую запись не переводим из её
 * собственной группы в другую: отпечатки потомков сменились бы, и обмен
 * разнёс бы это как правку.
 */
const PARENT_ENTITIES: ReadonlySet<ExchangeEntity> = new Set(
  EXCHANGE_ENTITIES.filter((entity) => EXCHANGE_ENTITIES.some((child) => ENTITY_PARENT[child]?.entity === entity)),
);

/** Помещению, цеху и оборудованию годится только запись того же объекта или цеха. */
const SAME_PARENT: ReadonlySet<ExchangeEntity> = new Set<ExchangeEntity>(["room", "area", "equipment"]);

/** Нужна ли для подбора записей группа родителя записи-источника. */
export function candidateNeedsParent(entity: ExchangeEntity): boolean {
  return SAME_PARENT.has(entity);
}

/** Запись получателя, которую видит обмен (`loadEntityRows`), со своей связью. */
export type SkipCandidateRow = {
  id: string;
  name: string;
  detail: string | null;
  /** Группа родителя у получателя (объект, цех, должность). */
  parentGroupId: string | null;
  /** Группы, в которых запись уже связана в этом кабинете. */
  linkedGroupIds: readonly string[];
  /** В её группе есть живые записи других организаций. */
  linkedShared: boolean;
};

export type SkipCandidateQuery = {
  entity: ExchangeEntity;
  /** Группа пропущенной записи. */
  groupId: string;
  name: string;
  /** Группа родителя записи-источника; нужна помещению, цеху и оборудованию. */
  parentGroupId: string | null;
  /** Источник — организация другого аккаунта: людей двух компаний вручную не связываем. */
  crossAccount: boolean;
};

/**
 * Годится ли запись получателя для «Связать с …» (Р9.3): тот же вид, то же
 * название без учёта регистра и пробелов; у помещения, цеха и оборудования —
 * тот же объект или цех. Запись, уже связанная с другой группой, годится,
 * только если в той группе она одна (её никто не получил) и потомков в
 * обмене у неё нет: тогда та группа просто освобождается.
 */
export function isSkipCandidate(query: SkipCandidateQuery, row: SkipCandidateRow): boolean {
  if (query.entity === "staff" && query.crossAccount) return false;
  const name = normalizeExchangeName(query.name);
  if (!name || normalizeExchangeName(row.name) !== name) return false;
  if (SAME_PARENT.has(query.entity)) {
    const required = ENTITY_PARENT[query.entity]?.required === true;
    if (required && !query.parentGroupId) return false;
    if (row.parentGroupId !== query.parentGroupId) return false;
  }
  if (row.linkedGroupIds.length === 0) return true;
  if (row.linkedGroupIds.length > 1 || row.linkedGroupIds[0] === query.groupId) return false;
  return !row.linkedShared && !PARENT_ENTITIES.has(query.entity);
}

export function skipCandidates<Row extends SkipCandidateRow>(query: SkipCandidateQuery, rows: readonly Row[]): Row[] {
  return rows.filter((row) => isSkipCandidate(query, row));
}

/* ───────────────────────── ответ для окна «Разобрать» ───────────────────────── */

export type ExchangeSkipCandidate = { id: string; name: string; detail: string | null };

export type ExchangeSkipItem = {
  id: string;
  entity: ExchangeEntity;
  kind: ExchangeKind;
  name: string;
  reason: ExchangeSkipReason;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** С чем можно связать (только для `conflict`). */
  candidates: ExchangeSkipCandidate[];
};

export type ExchangeSkipOrganization = { organizationId: string; name: string; items: ExchangeSkipItem[] };

export type ExchangeSkipsView = { total: number; organizations: ExchangeSkipOrganization[] };

export const EMPTY_SKIPS: ExchangeSkipsView = { total: 0, organizations: [] };

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asMoment(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * Разбор ответа сервера: строки без id, с неизвестным видом или причиной
 * пропускаются, организации без строк — тоже; `total` — по тому, что осталось.
 */
export function parseExchangeSkips(value: unknown): ExchangeSkipsView {
  const organizations: ExchangeSkipOrganization[] = [];
  for (const entry of asList(asObject(value)?.organizations)) {
    const organization = asObject(entry);
    const organizationId = asText(organization?.organizationId);
    if (!organization || !organizationId) continue;
    const items: ExchangeSkipItem[] = [];
    for (const raw of asList(organization.items)) {
      const item = asObject(raw);
      const id = asText(item?.id);
      if (!item || !id || !isExchangeEntity(item.entity) || !isSkipReason(item.reason)) continue;
      const candidates: ExchangeSkipCandidate[] = [];
      if (item.reason === "conflict") {
        for (const rawCandidate of asList(item.candidates)) {
          const candidate = asObject(rawCandidate);
          const candidateId = asText(candidate?.id);
          if (!candidate || !candidateId) continue;
          const detail = asText(candidate.detail).trim();
          candidates.push({ id: candidateId, name: asText(candidate.name), detail: detail || null });
        }
      }
      items.push({
        id,
        entity: item.entity,
        kind: ENTITY_KIND[item.entity],
        name: asText(item.name),
        reason: item.reason,
        firstSeenAt: asMoment(item.firstSeenAt),
        lastSeenAt: asMoment(item.lastSeenAt),
        candidates,
      });
    }
    if (items.length > 0) organizations.push({ organizationId, name: asText(organization.name), items });
  }
  return { total: organizations.reduce((sum, organization) => sum + organization.items.length, 0), organizations };
}

/** Строку разобрали: убрать её из окна (и организацию, если строк не осталось). */
export function withoutSkip(view: ExchangeSkipsView, id: string): ExchangeSkipsView {
  const organizations = view.organizations
    .map((organization) => ({ ...organization, items: organization.items.filter((item) => item.id !== id) }))
    .filter((organization) => organization.items.length > 0);
  return { total: organizations.reduce((sum, organization) => sum + organization.items.length, 0), organizations };
}
