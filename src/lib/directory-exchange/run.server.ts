import { isInactivePlan } from "@/lib/plan-limits";
import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { advisoryLockKey, withAdvisoryTryLock, type AdvisoryLockResult } from "@/lib/advisory-lock";
import { db } from "@/lib/db";
import {
  createEntityRow,
  hasOwnJournalPoints,
  loadEntityRows,
  updateEntityRow,
  type CreateOutcome,
  type EntityRow,
  type ParentGroupLookup,
  type UpdateOutcome,
} from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { changeSnapshot } from "@/lib/directory-exchange/history";
import { recordExchangeChanges, type ExchangeChangeRecord } from "@/lib/directory-exchange/history.server";
import {
  ENTITY_KIND,
  ENTITY_PARENT,
  EXCHANGE_ENTITIES,
  EXCHANGE_KINDS,
  FOREIGN_HASH_PREFIX,
  KIND_ENTITIES,
  emptyKindRecord,
  entityScope,
  isCurrentHash,
  isSingleRecordEntity,
  naturalKey,
  normalizeExchangeKinds,
  rowHashLike,
  type ExchangeEntity,
  type ExchangeKind,
  type ExchangeScope,
  normalizeExchangeName,
} from "@/lib/directory-exchange/kinds";
import {
  MIXED_ORIGIN,
  companyReceivesGroup,
  pendingGroupOrigins,
  planEntityExchange,
  rebaseLinks,
  unmarkedGroupRecords,
  type DatedLinkRow,
  type ExchangeCompanies,
  type ExchangeLinkRow,
} from "@/lib/directory-exchange/plan";
import type { ExchangeTrigger } from "@/lib/directory-exchange/runs";
import { finishExchangeRun, pruneExchangeLogs, startExchangeRun } from "@/lib/directory-exchange/runs.server";
import type { ExchangeSkipRecord } from "@/lib/directory-exchange/skips";
import { recordExchangeSkips } from "@/lib/directory-exchange/skips-record.server";
import {
  emptyKindCounters,
  summaryTotals,
  type ExchangeCounters,
  type ExchangeSummary,
} from "@/lib/directory-exchange/summary";
import { startTransferRecord } from "@/lib/directory-exchange/transfer-undo.server";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { ORG_LOCKED_CODE, ORG_LOCKED_MESSAGE } from "@/lib/org-trial";
import { isOrganizationLocked } from "@/lib/org-trial.server";

/**
 * Обмен справочниками между организациями аккаунта через мастер-кабинет
 * (правила Р3–Р8) и разовый перенос (Р6).
 *
 * Обмен идёт по сущностям в порядке зависимостей: сначала должности, потом
 * сотрудники; объекты → помещения → цеха → оборудование; продукты. На каждой
 * сущности планировщик (`plan.ts`) сравнивает строки участников с таблицей
 * соответствий, операции применяются правилами ручного ввода
 * (`entities.server.ts`), связи записываются сразу — следующая сущность уже
 * видит группы своих родителей.
 *
 * Отказ тарифа и занятое название не останавливают обмен: запись
 * пропускается, попадает в итог и пробуется снова при следующем обмене.
 *
 * Обмен с чужим аккаунтом (часть 3): участник с `foreign = true` добавлен
 * подтверждённым запросом (`requests.server.ts`) и участвует в обмене
 * кабинета, хотя его аккаунт другой. Пока среди участников списка
 * «Сотрудники» есть такой, сотрудники обмениваются только как ФИО и должность
 * (правило Р5, состав полей `foreign` в kinds.ts) — у всех участников списка.
 * Ещё три правила для него:
 *   • компаний у кабинета может быть несколько (серия C1, схема «звезда»):
 *     каждая получает записи владельца, но не записи другой компании — группа
 *     помнит, чья запись её начала (`originOrganizationId`, правило в plan.ts;
 *     у групп до C1 отметку дописывает `settleGroupOrigins`);
 *   • её правки записей владельца не меняют (пассивный участник в plan.ts):
 *     новые записи идут в обе стороны, правки — только от владельца к ней;
 *   • люди двух компаний по ФИО не сопоставляются (`owner` в ключе
 *     сотрудника): однофамильцы остаются каждый у себя.
 *
 * Серия D: каждая попытка обмена — строка журнала `DirectoryExchangeRun`
 * (повод, итог, длительность, счётчики, текст ошибки; runs.server.ts), а
 * каждое созданное и изменённое у организации — строка истории
 * `DirectoryExchangeChange` с полями до и после (history.server.ts).
 */

export type ExchangeActor = { userId: string; userName: string | null };
export type TransferSelection = Partial<Record<ExchangeKind, readonly string[] | "all">>;
export type TransferItem = {
  id: string;
  name: string;
  /** Подпись: должность сотрудника, объект помещения, цех оборудования, поставщик. */
  detail: string | null;
  /** Запись с таким ключом у получателя уже есть — перенос её пропустит. */
  exists: boolean;
  entity: ExchangeEntity;
  /** Родитель в том же списке (должность, объект, цех): подтянется сам. */
  parentId: string | null;
};
export type TransferPreview = { items: Record<ExchangeKind, TransferItem[]> };
export type ExchangeBatchResult = {
  /** Кабинетов с обменом (два участника и больше). */
  cabinets: number;
  /** Сколько из них сейчас заняты другим обменом и пропущены. */
  busy: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type SkipReason = "limit" | "conflict";
type Participant = {
  organizationId: string;
  name: string;
  kinds: readonly ExchangeKind[];
  /** Организация другого аккаунта, добавленная подтверждённым запросом. */
  foreign: boolean;
  /** Чья организация: `exchangeAccountKey`. */
  accountKey: string;
};
type LinkWrite = { groupId: string; organizationId: string; entityId: string | null; hash: string };
/** Компания — аккаунт; организация, которой больше нет, — компания сама по себе. */
const companyLookup = (known: ReadonlyMap<string, string>) => (organizationId: string) => known.get(organizationId) ?? `missing:${organizationId}`;

/**
 * Когда созданы записи сущности (для отметки групп до C1, Р6.4). У цехов и
 * оборудования даты нет — пустой ответ, отметка тогда считается осторожно.
 */
async function recordsCreatedAt(entity: string, entityIds: readonly string[]): Promise<Map<string, Date>> {
  const created = new Map<string, Date>();
  const ids = [...new Set(entityIds)];
  for (let index = 0; index < ids.length; index += 1000) {
    const where = { id: { in: ids.slice(index, index + 1000) } };
    const select = { id: true, createdAt: true } as const;
    let rows: Array<{ id: string; createdAt: Date }> = [];
    switch (entity) {
      case "product":
        rows = await db.product.findMany({ where, select });
        break;
      case "position":
        rows = await db.jobPosition.findMany({ where, select });
        break;
      case "staff":
        rows = await db.user.findMany({ where, select });
        break;
      case "building":
        rows = await db.building.findMany({ where, select });
        break;
      case "room":
        rows = await db.room.findMany({ where, select });
        break;
      default:
        return created;
    }
    for (const row of rows) created.set(row.id, row.createdAt);
  }
  return created;
}

/** Отметки групп до C1 (`pendingGroupOrigins`: по времени связей, в одном обмене — по датам записей); `links` — связи одной сущности. */
async function legacyOriginsOf(entity: string, links: readonly DatedLinkRow[], companies: ExchangeCompanies): Promise<Map<string, string>> {
  const created = await recordsCreatedAt(entity, unmarkedGroupRecords(links));
  return pendingGroupOrigins(links, companies, (entityId) => created.get(entityId) ?? null);
}

/** Компании организаций (`exchangeAccountKey`) по их id. */
async function loadCompanies(organizationIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set(organizationIds)];
  if (ids.length === 0) return new Map();
  const organizations = await db.organization.findMany({ where: { id: { in: ids } }, select: { id: true, accountId: true } });
  return new Map(organizations.map((organization) => [organization.id, exchangeAccountKey(organization)]));
}

/** Компания организации: её аккаунт, а у организации без аккаунта — она сама. */
export function exchangeAccountKey(organization: { id: string; accountId: string | null }): string {
  return organization.accountId ?? `org:${organization.id}`;
}

const LOCK_PREFIX = "directory-exchange";
const TRANSFER_LOCK_PREFIX = "directory-transfer";
/** Большой первый обмен идёт минутами — замок не должен отпустить его раньше. */
const RUN_TIMEOUT_MS = 10 * 60_000;
/** Запись одной сущности может завести запись другой (цех — помещение): второй проход их подбирает. */
const MAX_PASSES = 3;
export const EXCHANGE_BUSY_CODE = "exchange_busy";
const BUSY_MESSAGE = "Обмен уже выполняется. Подождите минуту и повторите.";
const FAILED_NOTE = "Часть записей не удалось обработать из-за ошибки — они будут обработаны при следующем обмене.";

/** Счётчики по организациям и спискам; повторный пропуск той же записи не считается дважды. */
class Tally {
  private readonly counters = new Map<string, Record<ExchangeKind, ExchangeCounters>>();
  private readonly skips = new Set<string>();

  private of(organizationId: string, kind: ExchangeKind): ExchangeCounters {
    let kinds = this.counters.get(organizationId);
    if (!kinds) this.counters.set(organizationId, (kinds = emptyKindCounters()));
    return kinds[kind];
  }

  created(organizationId: string, kind: ExchangeKind) {
    this.of(organizationId, kind).created += 1;
  }

  updated(organizationId: string, kind: ExchangeKind) {
    this.of(organizationId, kind).updated += 1;
  }

  skipped(organizationId: string, kind: ExchangeKind, reason: SkipReason, dedupeKey: string) {
    const key = `${organizationId}\u0000${dedupeKey}`;
    if (this.skips.has(key)) return;
    this.skips.add(key);
    const counters = this.of(organizationId, kind);
    if (reason === "limit") counters.skippedLimit += 1;
    else counters.skippedConflict += 1;
  }

  kindsOf(organizationId: string): Record<ExchangeKind, ExchangeCounters> {
    return this.counters.get(organizationId) ?? emptyKindCounters();
  }
}

/** Строка разбора для пропущенного создания (`DirectoryExchangeSkip`). */
function skipRecord(
  op: { groupId: string; organizationId: string; fromOrganizationId: string; fromEntityId: string },
  name: string,
  reason: SkipReason,
): ExchangeSkipRecord {
  return {
    groupId: op.groupId,
    organizationId: op.organizationId,
    sourceOrganizationId: op.fromOrganizationId,
    sourceEntityId: op.fromEntityId,
    name,
    reason,
  };
}

function hasCounters(kinds: Record<ExchangeKind, ExchangeCounters>): boolean {
  return EXCHANGE_KINDS.some((kind) => Object.values(kinds[kind]).some((value) => value > 0));
}

async function writeAudit(params: {
  organizationId: string;
  actor: ExchangeActor | null;
  action: string;
  details: Prisma.InputJsonObject;
}) {
  try {
    await db.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.actor?.userId ?? null,
        userName: params.actor?.userName ?? null,
        action: params.action,
        entity: "organization",
        entityId: params.organizationId,
        details: params.details,
      },
    });
  } catch (error) {
    console.error("[directory-exchange] audit failed", { organizationId: params.organizationId, action: params.action, error });
  }
}

/* ───────────────────────── обмен ───────────────────────── */

/**
 * Обмен одной сущностью между участниками. Возвращает число созданных и
 * обновлённых записей. Созданное и изменённое у каждой организации
 * записывается в историю обмена (`runId` — строка журнала этого обмена).
 */
async function exchangeEntity(params: {
  masterOrganizationId: string;
  runId: string | null;
  entity: ExchangeEntity;
  participants: readonly Participant[];
  tally: Tally;
  /** Не созданные записи: «сущность|группа|организация» → причина (для потомков). */
  blocked: Map<string, SkipReason>;
  notes: Set<string>;
  /** Компании участников и основателей групп (Р6.3). */
  companies: ExchangeCompanies;
}): Promise<number> {
  const { masterOrganizationId, runId, entity, participants, tally, blocked, notes, companies } = params;
  const kind = ENTITY_KIND[entity];
  const parent = ENTITY_PARENT[entity];
  const organizationIds = participants.map((participant) => participant.organizationId);
  // Р5: среди участников списка есть организация другого аккаунта — состав
  // полей «между аккаунтами» действует для всех участников этого списка.
  const foreign = participants.filter((participant) => participant.foreign);
  const scope: ExchangeScope = entityScope(entity, foreign.length > 0 ? "foreign" : "account");
  // Есть чужая компания — ключ записи несёт её владельца (у сотрудников):
  // люди разных компаний по ФИО не сопоставляются.
  const ownerOf = new Map(participants.map((participant) => [participant.organizationId, participant.accountKey]));
  const sharesObjects = new Set(
    participants.filter((participant) => participant.kinds.includes("objects")).map((participant) => participant.organizationId),
  );

  const [links, parentLinks] = await Promise.all([
    db.directoryExchangeLink.findMany({
      where: { masterOrganizationId, entity, organizationId: { in: organizationIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { groupId: true, organizationId: true, entityId: true, hash: true, originOrganizationId: true },
    }),
    parent
      ? db.directoryExchangeLink.findMany({
          where: { masterOrganizationId, entity: parent.entity, organizationId: { in: organizationIds } },
          select: { groupId: true, organizationId: true, entityId: true },
        })
      : Promise.resolve([]),
  ]);

  // Родители: id в своей организации ↔ группа (null — родителя там удалили).
  const parentGroupOf = new Map<string, Map<string, string>>();
  const parentEntityOf = new Map<string, Map<string, string | null>>();
  for (const link of parentLinks) {
    let entities = parentEntityOf.get(link.organizationId);
    if (!entities) parentEntityOf.set(link.organizationId, (entities = new Map()));
    entities.set(link.groupId, link.entityId);
    if (!link.entityId) continue;
    let groups = parentGroupOf.get(link.organizationId);
    if (!groups) parentGroupOf.set(link.organizationId, (groups = new Map()));
    groups.set(link.entityId, link.groupId);
  }
  const lookupFor = (organizationId: string): ParentGroupLookup => {
    const groups = parentGroupOf.get(organizationId);
    return (id) => groups?.get(id) ?? null;
  };
  const loadRows = (organizationId: string) =>
    loadEntityRows(entity, organizationId, lookupFor(organizationId), scope, foreign.length > 0 ? ownerOf.get(organizationId) ?? null : null);

  const rows: Record<string, EntityRow[]> = {};
  const rowIndex = new Map<string, Map<string, EntityRow>>();
  for (const organizationId of organizationIds) {
    rows[organizationId] = await loadRows(organizationId);
    rowIndex.set(organizationId, new Map(rows[organizationId].map((row) => [row.id, row])));
  }

  // Состав полей сменился с прошлого обмена (в список вошла организация
  // другого аккаунта или вышла из него, Р5; вышла новая версия состава, Р8.0)
  // — это не правка записей: связи переводятся на нынешний отпечаток, чужие
  // телефоны никуда не едут, новые поля у соседей не перезаписываются.
  const aligned = rebaseLinks({
    rows,
    links,
    isCurrent: (hash) => isCurrentHash(entity, hash, scope),
    // Прежний отпечаток считается из тех же строк в его версии и составе;
    // прежний полный «внутри аккаунта» — нет, когда телефон и выходные (или
    // журналы должности) сейчас не читаются: тогда null.
    hashLike: (row, linkHash) => rowHashLike(entity, row.fields, row.parentGroupId, linkHash, scope),
  });

  const planned = planEntityExchange({
    participants: organizationIds,
    rows,
    links: aligned.links,
    // Правки чужой компании записей владельца не меняют.
    passive: foreign.map((participant) => participant.organizationId),
    // Компании не получают записей друг друга (Р6.3).
    companies,
    newGroupId: randomUUID,
  });
  // Настройки журналов (Р8.1) у организации одни и уже связаны со своей
  // группой: «создать» в другой группе нечего — ни записи, ни пропуска.
  const ops = isSingleRecordEntity(entity) ? planned.filter((op) => op.type !== "create") : planned;
  // Пропуски создания — в строки разбора (Р9.1); то, что проход создал,
  // связал или сделал надгробием, из разбора уходит.
  const skipped = new Map<string, ExchangeSkipRecord>();
  const syncSkips = () =>
    recordExchangeSkips({
      masterOrganizationId,
      entity,
      organizationIds,
      groups: [...links.map((link) => link.groupId), ...ops.map((op) => op.groupId)],
      skipped: [...skipped.values()],
    });
  if (ops.length === 0 && aligned.rebased.length === 0) {
    await syncSkips();
    return 0;
  }

  const linkKey = (groupId: string, organizationId: string) => `${groupId}\u0000${organizationId}`;
  const stored = new Map<string, ExchangeLinkRow>(links.map((link) => [linkKey(link.groupId, link.organizationId), link]));
  // Отметка группы (Р6.2): новая связь получает отметку своей группы, новая
  // группа — своего основателя; правка связи отметку не трогает.
  const groupOrigin = new Map<string, string>();
  for (const link of links) if (link.originOrganizationId) groupOrigin.set(link.groupId, link.originOrganizationId);
  for (const op of ops) if (op.type === "link" && op.originOrganizationId) groupOrigin.set(op.groupId, op.originOrganizationId);
  const writes = new Map<string, LinkWrite>();
  // Сначала переведённые связи; операции плана ниже пишут поверх них.
  for (const link of aligned.rebased) writes.set(linkKey(link.groupId, link.organizationId), { ...link });
  /** Связи, появившиеся в этом же плане: при неудачной правке откатываются. */
  const fresh = new Set<string>();
  /** Группы, где правка дошла не до всех: образец остаётся «изменённым» до следующего обмена. */
  const failedGroups = new Set<string>();
  const touched = new Map<string, Set<string>>();
  const touch = (organizationId: string, entityId: string) => {
    let ids = touched.get(organizationId);
    if (!ids) touched.set(organizationId, (ids = new Set()));
    ids.add(entityId);
  };
  let changes = 0;
  /** История (серия D, Р5): что применено у организаций; поля «после» — из перечитанных строк. */
  const applied: Array<{
    op: "create" | "update";
    organizationId: string;
    entityId: string;
    groupId: string;
    from: string;
    source: EntityRow;
    before: EntityRow | null;
  }> = [];

  for (const op of ops) {
    const key = linkKey(op.groupId, op.organizationId);
    if (op.type === "tombstone") {
      writes.set(key, { groupId: op.groupId, organizationId: op.organizationId, entityId: null, hash: stored.get(key)?.hash ?? "" });
      continue;
    }
    if (op.type === "link") {
      writes.set(key, { groupId: op.groupId, organizationId: op.organizationId, entityId: op.entityId, hash: op.hash });
      fresh.add(key);
      continue;
    }
    if (op.type === "rehash") continue;

    const source = rowIndex.get(op.fromOrganizationId)?.get(op.fromEntityId);
    if (!source) continue;
    const parentGroupId = parent ? source.parentGroupId : null;
    const knownParent = parentGroupId ? parentEntityOf.get(op.organizationId)?.get(parentGroupId) : undefined;
    const skipKey = `${entity}|${op.groupId}`;

    if (op.type === "create") {
      let parentId: string | null = null;
      if (parent?.required) {
        if (typeof knownParent !== "string") {
          // Родителя здесь удалили — и потомок не нужен; родителя не удалось
          // создать — потомок ждёт его с той же причиной.
          if (knownParent === null) {
            writes.set(key, { groupId: op.groupId, organizationId: op.organizationId, entityId: null, hash: op.hash });
            continue;
          }
          const reason = blocked.get(`${parent.entity}|${parentGroupId}|${op.organizationId}`) ?? "conflict";
          blocked.set(`${skipKey}|${op.organizationId}`, reason);
          tally.skipped(op.organizationId, kind, reason, skipKey);
          skipped.set(key, skipRecord(op, source.name, reason));
          continue;
        }
        parentId = knownParent;
      } else if (typeof knownParent === "string") {
        parentId = knownParent;
      }

      let outcome: CreateOutcome;
      try {
        outcome = await createEntityRow(entity, op.organizationId, source, parentId, {
          // Помещения участника, который обменивается объектами, приходят обменом.
          mirrorRoom: !sharesObjects.has(op.organizationId),
          scope,
        });
      } catch (error) {
        console.error("[directory-exchange] create failed", { entity, organizationId: op.organizationId, error });
        notes.add(FAILED_NOTE);
        outcome = { status: "conflict" };
      }
      if (outcome.status === "created") {
        writes.set(key, { groupId: op.groupId, organizationId: op.organizationId, entityId: outcome.id, hash: op.hash });
        touch(op.organizationId, outcome.id);
        tally.created(op.organizationId, kind);
        applied.push({
          op: "create",
          organizationId: op.organizationId,
          entityId: outcome.id,
          groupId: op.groupId,
          from: op.fromOrganizationId,
          source,
          before: null,
        });
        changes += 1;
      } else {
        blocked.set(`${skipKey}|${op.organizationId}`, outcome.status);
        tally.skipped(op.organizationId, kind, outcome.status, skipKey);
        skipped.set(key, skipRecord(op, source.name, outcome.status));
      }
      continue;
    }

    // update: родителя меняем, только когда у образца он другой и здесь он есть.
    const target = rowIndex.get(op.organizationId)?.get(op.entityId);
    const parentId =
      parent && typeof knownParent === "string" && target?.parentGroupId !== parentGroupId ? knownParent : undefined;
    let outcome: UpdateOutcome;
    try {
      outcome = await updateEntityRow(entity, op.organizationId, op.entityId, source, parentId, { scope });
    } catch (error) {
      console.error("[directory-exchange] update failed", { entity, organizationId: op.organizationId, error });
      notes.add(FAILED_NOTE);
      outcome = { status: "conflict" };
    }
    if (outcome.status === "updated") {
      writes.set(key, { groupId: op.groupId, organizationId: op.organizationId, entityId: op.entityId, hash: op.hash });
      touch(op.organizationId, op.entityId);
      tally.updated(op.organizationId, kind);
      applied.push({
        op: "update",
        organizationId: op.organizationId,
        entityId: op.entityId,
        groupId: op.groupId,
        from: op.fromOrganizationId,
        source,
        before: target ?? null,
      });
      changes += 1;
    } else {
      failedGroups.add(op.groupId);
      if (fresh.has(key)) writes.delete(key);
      if (outcome.status === "conflict" || outcome.status === "limit") tally.skipped(op.organizationId, kind, outcome.status, skipKey);
    }
  }

  // Отпечаток образца обновляется, только когда правку получили все.
  for (const op of ops) {
    if (op.type !== "rehash" || failedGroups.has(op.groupId)) continue;
    writes.set(linkKey(op.groupId, op.organizationId), {
      groupId: op.groupId,
      organizationId: op.organizationId,
      entityId: op.entityId,
      hash: op.hash,
    });
  }

  // Связь хранит отпечаток записи такой, какой она сохранилась на самом деле
  // (телефон мог привестись к формату, цех — получить другой объект): иначе
  // получатель выглядел бы «изменённым» и гонял правку обратно.
  const saved = new Map<string, Map<string, EntityRow>>();
  for (const [organizationId, ids] of touched) {
    const actual = new Map((await loadRows(organizationId)).map((row) => [row.id, row]));
    saved.set(organizationId, actual);
    for (const write of writes.values()) {
      if (write.organizationId !== organizationId || !write.entityId || !ids.has(write.entityId)) continue;
      const row = actual.get(write.entityId);
      if (row) write.hash = row.hash;
    }
  }

  const inserts: LinkWrite[] = [];
  for (const [key, write] of writes) {
    if (!stored.has(key)) {
      inserts.push(write);
      continue;
    }
    await db.directoryExchangeLink.update({
      where: {
        masterOrganizationId_entity_groupId_organizationId: {
          masterOrganizationId,
          entity,
          groupId: write.groupId,
          organizationId: write.organizationId,
        },
      },
      data: { entityId: write.entityId, hash: write.hash },
    });
  }
  if (inserts.length > 0) {
    await db.directoryExchangeLink.createMany({
      data: inserts.map((write) => ({ masterOrganizationId, entity, ...write, originOrganizationId: groupOrigin.get(write.groupId) ?? null })),
      skipDuplicates: true,
    });
  }
  await syncSkips();
  // История — одной пачкой; сбой записи обмен не останавливает.
  await recordExchangeChanges(
    applied.map((change): ExchangeChangeRecord => {
      const row = saved.get(change.organizationId)?.get(change.entityId) ?? null;
      return {
        runId,
        masterOrganizationId,
        organizationId: change.organizationId,
        entity,
        entityId: change.entityId,
        groupId: change.groupId,
        op: change.op,
        sourceOrganizationId: change.from,
        name: row?.name ?? change.source.name,
        before: change.before ? changeSnapshot(entity, change.before, scope) : null,
        // Запись не перечиталась (выпала из обмена сразу после записи) — поля образца без отпечатка.
        after: row ? changeSnapshot(entity, row, scope) : { scope, parentId: null, fields: change.source.fields, hash: null },
      };
    }),
  );
  return changes;
}


/**
 * Список «Сотрудники» переходит в состав «между аккаунтами» (Р5): среди его
 * участников появилась организация другого аккаунта — её подтвердили,
 * открыли после оплаты или сняли с паузы, — а связи своих организаций ещё
 * хранят полный отпечаток (сотрудника — с телефоном и выходными, должности —
 * с журналами).
 *
 * Полный отпечаток в суженном составе пересчитать нельзя (телефон не
 * читается), поэтому при переходе записи считаются неизменёнными
 * (`rebaseLinks`). Чтобы правка, сделанная прямо перед переходом, не
 * потерялась, свои организации сначала обмениваются между собой как обычно:
 * должности и сотрудники, с телефонами и журналами — и только внутри аккаунта
 * кабинета. После перехода связи суженные, и этот шаг больше не срабатывает.
 */
async function settleStaffBeforeForeign(params: {
  masterOrganizationId: string;
  runId: string | null;
  participants: readonly Participant[];
  tally: Tally;
  blocked: Map<string, SkipReason>;
  notes: Set<string>;
  companies: ExchangeCompanies;
}): Promise<void> {
  const sharing = params.participants.filter((participant) => participant.kinds.includes("staff"));
  if (!sharing.some((participant) => participant.foreign)) return;
  const own = sharing.filter((participant) => !participant.foreign);
  if (own.length < 2) return;
  const pending = await db.directoryExchangeLink.findFirst({
    where: {
      masterOrganizationId: params.masterOrganizationId,
      entity: { in: [...KIND_ENTITIES.staff] },
      organizationId: { in: own.map((participant) => participant.organizationId) },
      entityId: { not: null },
      NOT: { hash: { startsWith: FOREIGN_HASH_PREFIX } },
    },
    select: { id: true },
  });
  if (!pending) return;
  for (const entity of KIND_ENTITIES.staff) {
    await exchangeEntity({ ...params, entity, participants: own });
  }
}

/**
 * Отметка «чья запись начала группу» у связей без неё (Р6.2, Р6.4): группы,
 * начатые до C1, и связи, записанные без отметки. В группе есть связь с
 * отметкой — та же; нет — по времени связей: кто был в группе раньше
 * (`legacyGroupOrigin`). Под замком обмена, до плана; дописываются только
 * пустые отметки, поэтому повторный обмен ничего не меняет.
 */
async function settleGroupOrigins(masterOrganizationId: string, ownerCompany: string): Promise<void> {
  const unmarked = await db.directoryExchangeLink.findFirst({
    where: { masterOrganizationId, originOrganizationId: null },
    select: { id: true },
  });
  if (!unmarked) return;
  const links = await db.directoryExchangeLink.findMany({
    where: { masterOrganizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { entity: true, groupId: true, organizationId: true, entityId: true, hash: true, originOrganizationId: true, createdAt: true },
  });
  const companies = {
    owner: ownerCompany,
    of: companyLookup(await loadCompanies(links.map((link) => link.organizationId))),
  };
  const byEntity = new Map<string, DatedLinkRow[]>();
  for (const link of links) {
    const list = byEntity.get(link.entity);
    if (list) list.push(link);
    else byEntity.set(link.entity, [link]);
  }
  for (const [entity, entityLinks] of byEntity) {
    const byOrigin = new Map<string, string[]>();
    for (const [groupId, origin] of await legacyOriginsOf(entity, entityLinks, companies)) {
      const groups = byOrigin.get(origin);
      if (groups) groups.push(groupId);
      else byOrigin.set(origin, [groupId]);
    }
    for (const [origin, groupIds] of byOrigin) {
      for (let index = 0; index < groupIds.length; index += 1000) {
        await db.directoryExchangeLink.updateMany({
          where: { masterOrganizationId, entity, groupId: { in: groupIds.slice(index, index + 1000) }, originOrganizationId: null },
          data: { originOrganizationId: origin },
        });
      }
    }
  }
}

/** Компании участников обмена и организаций, начавших группы кабинета (Р6.3). */
async function cabinetCompanies(
  masterOrganizationId: string,
  ownerCompany: string,
  participants: readonly Participant[],
): Promise<ExchangeCompanies> {
  const origins = await db.directoryExchangeLink.groupBy({
    by: ["originOrganizationId"],
    where: { masterOrganizationId, originOrganizationId: { not: null } },
  });
  const known = await loadCompanies(origins.map((row) => row.originOrganizationId).filter((id): id is string => Boolean(id)));
  for (const participant of participants) known.set(participant.organizationId, participant.accountKey);
  return { owner: ownerCompany, of: companyLookup(known) };
}

async function exchangeUnderLock(
  masterOrganizationId: string,
  actor: ExchangeActor | null,
  now: Date,
  context: { runId: string | null; trigger: ExchangeTrigger },
): Promise<ExchangeSummary> {
  const { runId } = context;
  const cabinet = await db.organization.findFirst({
    where: { id: masterOrganizationId, kind: MASTER_ORG_KIND },
    select: { id: true, accountId: true },
  });
  if (!cabinet?.accountId) throw new DirectoryExchangeError("Мастер-кабинет не найден", 404);

  const members = await db.directoryExchangeMember.findMany({
    where: { masterOrganizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      kinds: true,
      foreign: true,
      organization: { select: { id: true, name: true, accountId: true, isDemo: true, kind: true, subscriptionPlan: true } },
    },
  });

  const notes = new Set<string>();
  const participants: Participant[] = [];
  // Компаний других аккаунтов может быть несколько (серия C1): участвуют все
  // подтверждённые, а записей друг друга они не получают (Р6.3, plan.ts).
  for (const member of members) {
    const organization = member.organization;
    const kinds = normalizeExchangeKinds(member.kinds);
    if (kinds.length === 0) continue;
    // Организации аккаунта кабинета и те, кого владелец кабинета сам
    // подтвердил по запросу (`foreign`); демо и сами кабинеты — никогда.
    if (organization.accountId !== cabinet.accountId && !member.foreign) continue;
    if (organization.isDemo || organization.kind === MASTER_ORG_KIND) continue;
    const accountKey = exchangeAccountKey(organization);
    // На паузе или отменена — как и остальная автоматика, обмен её не трогает.
    if (isInactivePlan(organization.subscriptionPlan)) continue;
    if (await isOrganizationLocked(organization.id, now)) {
      notes.add(`Организация «${organization.name}» закрыта до оплаты точки и в обмене не участвовала.`);
      continue;
    }
    // «Журналы» не обмениваются у организации с точками со своим набором журналов (entities.server.ts).
    if (kinds.includes("journals") && (await hasOwnJournalPoints(organization.id))) {
      kinds.splice(kinds.indexOf("journals"), 1);
      notes.add(`У «${organization.name}» есть точки со своим набором журналов — список «Журналы» для неё не обменивается.`);
      if (kinds.length === 0) continue;
    }
    participants.push({ organizationId: organization.id, name: organization.name, kinds, foreign: member.foreign, accountKey });
  }

  const tally = new Tally();
  const blocked = new Map<string, SkipReason>();
  if (participants.length >= 2) {
    const ownerCompany = exchangeAccountKey(cabinet);
    await settleGroupOrigins(masterOrganizationId, ownerCompany);
    const companies = await cabinetCompanies(masterOrganizationId, ownerCompany, participants);
    await settleStaffBeforeForeign({ masterOrganizationId, runId, participants, tally, blocked, notes, companies });
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let changes = 0;
      for (const entity of EXCHANGE_ENTITIES) {
        const sharing = participants.filter((participant) => participant.kinds.includes(ENTITY_KIND[entity]));
        if (sharing.length < 2) continue;
        changes += await exchangeEntity({ masterOrganizationId, runId, entity, participants: sharing, tally, blocked, notes, companies });
      }
      if (changes === 0) break;
    }
  }

  const summary: ExchangeSummary = {
    organizations: participants.map((participant) => ({
      organizationId: participant.organizationId,
      name: participant.name,
      kinds: tally.kindsOf(participant.organizationId),
    })),
    notes: [...notes],
  };

  // Итог целиком — у участников своего аккаунта. У участника из другого
  // аккаунта в его строке остаётся только его собственная часть: названия
  // организаций владельца кабинета и пояснения о них ему не предназначены.
  await db.directoryExchangeMember.updateMany({
    where: { masterOrganizationId, foreign: false },
    data: { lastSyncedAt: now, lastSyncJson: summary as unknown as Prisma.InputJsonObject },
  });
  const foreignMembers = await db.directoryExchangeMember.findMany({
    where: { masterOrganizationId, foreign: true },
    select: { id: true, organizationId: true },
  });
  for (const member of foreignMembers) {
    const own: ExchangeSummary = {
      organizations: summary.organizations.filter((organization) => organization.organizationId === member.organizationId),
      notes: [],
    };
    await db.directoryExchangeMember.update({
      where: { id: member.id },
      data: { lastSyncedAt: now, lastSyncJson: own as unknown as Prisma.InputJsonObject },
    });
  }
  const foreignIds = new Set(participants.filter((participant) => participant.foreign).map((participant) => participant.organizationId));
  for (const organization of summary.organizations) {
    if (!hasCounters(organization.kinds)) continue;
    const isForeign = foreignIds.has(organization.organizationId);
    await writeAudit({
      organizationId: organization.organizationId,
      // Обмен запускает владелец кабинета: в журнал организации другого
      // аккаунта не пишутся ни его имя, ни id его кабинета.
      actor: isForeign ? null : actor,
      action: "directory_exchange.synced",
      details: {
        ...(isForeign ? { crossAccount: true } : { masterOrganizationId }),
        trigger: context.trigger,
        kinds: organization.kinds as unknown as Prisma.InputJsonObject,
      },
    });
  }
  return summary;
}

/**
 * Работа под замком обмена кабинета: тем же, под которым идёт сам обмен.
 * Отключение участника берёт его, чтобы дождаться идущего обмена, а не
 * удалять связи у него из-под рук. Замок занят дольше ожидания —
 * `DirectoryExchangeError` 409 (`EXCHANGE_BUSY_CODE`), ничего не сделано.
 * Внутри `fn` обмен этого кабинета запускать нельзя: он ждал бы сам себя.
 */
export async function withExchangeLock<T>(
  masterOrganizationId: string,
  fn: () => Promise<T>,
  options: { waitMs?: number } = {},
): Promise<T> {
  const delayMs = 250;
  const locked = await withAdvisoryTryLock(advisoryLockKey(LOCK_PREFIX, masterOrganizationId), fn, {
    attempts: Math.max(1, Math.ceil((options.waitMs ?? 4_000) / delayMs)),
    delayMs,
    timeoutMs: 60_000,
  });
  if (!locked.acquired) throw new DirectoryExchangeError(BUSY_MESSAGE, 409, EXCHANGE_BUSY_CODE);
  return locked.value;
}

export type { ExchangeTrigger } from "@/lib/directory-exchange/runs";

/**
 * Обмен справочниками кабинета: участники — организации аккаунта кабинета и
 * подтверждённые организации других аккаунтов (`foreign`) с отмеченными
 * списками, кроме закрытых после своих 14 дней. Одновременно
 * идёт один обмен на кабинет; занято — `DirectoryExchangeError` 409.
 * `actor` — кто запустил вручную; без него обмен считается плановым.
 * `trigger` — повод для журнала обменов (серия D, Р2): по умолчанию
 * `manual` с `actor` и `schedule` без него. Каждая попытка — строка журнала:
 * готово, занято или ошибка (сбой записи журнала обмен не ломает).
 */
export async function runDirectoryExchange(
  masterOrganizationId: string,
  options: { actor?: ExchangeActor; now?: Date; trigger?: ExchangeTrigger } = {},
): Promise<ExchangeSummary> {
  const now = options.now ?? new Date();
  const trigger = options.trigger ?? (options.actor ? "manual" : "schedule");
  const run = await startExchangeRun(masterOrganizationId, trigger);
  let locked: AdvisoryLockResult<ExchangeSummary>;
  try {
    locked = await withAdvisoryTryLock(
      advisoryLockKey(LOCK_PREFIX, masterOrganizationId),
      () => exchangeUnderLock(masterOrganizationId, options.actor ?? null, now, { runId: run?.id ?? null, trigger }),
      // Человек ждёт несколько секунд, плановый обмен занятый кабинет пропускает.
      { attempts: options.actor ? 16 : 1, delayMs: 250, timeoutMs: RUN_TIMEOUT_MS },
    );
  } catch (error) {
    await finishExchangeRun(run, { status: "error", error });
    throw error;
  }
  if (!locked.acquired) {
    await finishExchangeRun(run, { status: "busy" });
    throw new DirectoryExchangeError(BUSY_MESSAGE, 409, EXCHANGE_BUSY_CODE);
  }
  await finishExchangeRun(run, { status: "ok", summary: locked.value });
  return locked.value;
}

/** Сколько человек ждёт обмена в запросе, прежде чем он уйдёт в фон. */
export const EXCHANGE_WAIT_MS = 8_000;

export type ExchangeRunOutcome =
  | { running: false; summary: ExchangeSummary }
  /** Не уложился: обмен доходит в фоне; `done` — его итог (null — сбой, он уже записан в лог). */
  | { running: true; done: Promise<ExchangeSummary | null> };

/**
 * Обмен, которого человек ждёт не дольше `waitMs` (8 с): успел — итог сразу;
 * не успел — `running: true`, а обмен продолжается и пишет итог участникам
 * (`lastSyncJson`) — карточка «Обмен справочниками» покажет его. Отказ
 * до срока (кабинет занят, ошибка) — как у `runDirectoryExchange`. Маршрут
 * передаёт `done` в `after()`, чтобы процесс дождался конца обмена.
 */
export async function runDirectoryExchangeWithin(
  masterOrganizationId: string,
  options: { actor?: ExchangeActor; now?: Date; waitMs?: number; trigger?: ExchangeTrigger } = {},
): Promise<ExchangeRunOutcome> {
  // Строку журнала ведёт сам обмен: итог в фоне допишется, когда он закончится.
  const run = runDirectoryExchange(masterOrganizationId, { actor: options.actor, now: options.now, trigger: options.trigger });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"waiting">((resolve) => {
    timer = setTimeout(() => resolve("waiting"), Math.max(0, options.waitMs ?? EXCHANGE_WAIT_MS));
  });
  try {
    const first = await Promise.race([run, deadline]);
    if (first !== "waiting") return { running: false, summary: first };
  } finally {
    clearTimeout(timer);
  }
  const done = run.catch((error: unknown) => {
    console.error("[directory-exchange] background exchange failed", { masterOrganizationId, error });
    return null;
  });
  return { running: true, done };
}

/**
 * Плановый обмен: каждый кабинет с двумя и более участниками; сбой одного не
 * мешает остальным. Заодно чистит журнал обменов (старше 90 дней) и историю
 * изменений (старше 30 дней).
 */
export async function runAllDirectoryExchanges(options: { now?: Date } = {}): Promise<ExchangeBatchResult> {
  const result: ExchangeBatchResult = { cabinets: 0, busy: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  await pruneExchangeLogs(options.now ?? new Date());
  const groups = await db.directoryExchangeMember.groupBy({ by: ["masterOrganizationId"], _count: { _all: true } });
  for (const group of groups) {
    if (group._count._all < 2) continue;
    result.cabinets += 1;
    try {
      const totals = summaryTotals(await runDirectoryExchange(group.masterOrganizationId, { now: options.now, trigger: "schedule" }));
      result.created += totals.created;
      result.updated += totals.updated;
      result.skipped += totals.skippedLimit + totals.skippedConflict;
    } catch (error) {
      if (error instanceof DirectoryExchangeError && error.code === EXCHANGE_BUSY_CODE) {
        result.busy += 1;
        continue;
      }
      console.error("[directory-exchange] scheduled exchange failed", { masterOrganizationId: group.masterOrganizationId, error });
      result.errors.push(`cabinet=${group.masterOrganizationId}: ${(error as Error)?.message ?? "ошибка"}`);
    }
  }
  result.errors = result.errors.slice(0, 10);
  return result;
}

/* ───────────────────────── разовый перенос ───────────────────────── */

type TransferMaps = Record<ExchangeEntity, Map<string, string>>;
type TransferState = {
  /** Запись получателя → запись источника, с которой она совпала по ключу. */
  toGroupOf: TransferMaps;
  /** Запись источника → запись получателя (совпавшая или только что созданная). */
  toEntityOf: TransferMaps;
};

function transferMaps(): TransferMaps {
  return Object.fromEntries(EXCHANGE_ENTITIES.map((entity) => [entity, new Map<string, string>()])) as TransferMaps;
}

/**
 * Обе организации — рабочие, ни одна не закрыта, и они из одного аккаунта.
 * Пара из разных аккаунтов проходит только с `crossAccount` — его передаёт
 * один вызывающий: подтверждение запроса владельцем кабинета
 * (`requests.server.ts`). `scope` — состав полей переноса: между аккаунтами
 * сотрудники идут только как ФИО и должность (Р5).
 */
async function loadTransferPair(
  fromOrganizationId: string,
  toOrganizationId: string,
  now: Date,
  options: { crossAccount?: boolean } = {},
) {
  if (fromOrganizationId === toOrganizationId) throw new DirectoryExchangeError("Выберите другую организацию", 400);
  const organizations = await db.organization.findMany({
    where: { id: { in: [fromOrganizationId, toOrganizationId] }, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
    select: { id: true, name: true, accountId: true },
  });
  const from = organizations.find((organization) => organization.id === fromOrganizationId);
  const to = organizations.find((organization) => organization.id === toOrganizationId);
  if (!from || !to) throw new DirectoryExchangeError("Организация не найдена", 404);
  const sameAccount = Boolean(from.accountId) && from.accountId === to.accountId;
  if (!sameAccount && options.crossAccount !== true) {
    throw new DirectoryExchangeError("Организация не найдена", 404);
  }
  for (const organization of [to, from]) {
    if (await isOrganizationLocked(organization.id, now)) {
      throw new DirectoryExchangeError(ORG_LOCKED_MESSAGE, 409, ORG_LOCKED_CODE);
    }
  }
  const scope: ExchangeScope = sameAccount ? "account" : "foreign";
  // Между аккаунтами люди по ФИО не сопоставляются: ключ сотрудника несёт владельца.
  const owners = sameAccount ? null : { from: exchangeAccountKey(from), to: exchangeAccountKey(to) };
  return { from, to, scope, owners };
}

type TransferOwners = { from: string; to: string } | null;

/**
 * Строки источника и какие из них у получателя уже есть. Связь при переносе
 * не хранится, поэтому группа записи — id записи источника: совпавшие по
 * ключу записи получателя становятся «теми же», и потомки находят родителя.
 */
async function matchTransferEntity(
  entity: ExchangeEntity,
  fromOrganizationId: string,
  toOrganizationId: string,
  state: TransferState,
  scope: ExchangeScope,
  owners: TransferOwners,
): Promise<{ fromRows: EntityRow[]; exists: Set<string> }> {
  const parent = ENTITY_PARENT[entity];
  const fromLookup: ParentGroupLookup = !parent
    ? () => null
    : parent.required
      ? (id) => id
      : // Объект цеха входит в ключ, только если он есть у получателя: иначе
        // одноимённый цех получателя считался бы другим цехом.
        (id) => (state.toEntityOf[parent.entity].has(id) ? id : null);
  const toLookup: ParentGroupLookup = parent ? (id) => state.toGroupOf[parent.entity].get(id) ?? null : () => null;
  const [fromRows, toRows] = await Promise.all([
    loadEntityRows(entity, fromOrganizationId, fromLookup, scope, owners?.from ?? null),
    loadEntityRows(entity, toOrganizationId, toLookup, scope, owners?.to ?? null),
  ]);
  const toByKey = new Map<string, EntityRow>();
  for (const row of toRows) if (row.key !== null && !toByKey.has(row.key)) toByKey.set(row.key, row);
  const exists = new Set<string>();
  for (const row of fromRows) {
    const match = row.key === null ? undefined : toByKey.get(row.key);
    if (!match) continue;
    // Настройки журналов у получателя есть всегда: «уже есть» — только
    // когда они такие же, как у источника; иначе перенос их заменит.
    if (!isSingleRecordEntity(entity) || match.hash === row.hash) exists.add(row.id);
    state.toEntityOf[entity].set(row.id, match.id);
    if (!state.toGroupOf[entity].has(match.id)) state.toGroupOf[entity].set(match.id, row.id);
  }
  return { fromRows, exists };
}

type WithheldRows = Record<ExchangeEntity, Set<string>>;

/**
 * Записи источника, которые другой компании не передаются (Р6.5):
 *   • связанные в обмене кабинета с группой, начатой не владельцем кабинета и
 *     не самой этой компанией (`companyReceivesGroup`); у группы до C1 без
 *     отметки — по тем же правилам, что и при обмене (`legacyOriginsOf`,
 *     только для чтения);
 *   • о которых связи кабинета молчат (организация вышла из обмена — её связи
 *     удалены, а копии остались; запись не связана): по естественному ключу
 *     совпадают с живой записью другой компании в группе этой компании или
 *     «смешанной». Ключ — как в обмене, но родитель любой, а сотрудник — по
 *     ФИО: групп у такой организации нет. Своя запись владельца с тем же
 *     названием тоже не передаётся — лучше лишний отказ, чем чужая запись.
 * Запись, чей обязательный родитель не передаётся, тоже не передаётся.
 */
async function withheldTransferRows(
  masterOrganizationId: string,
  fromOrganizationId: string,
  toCompany: string,
  scope: ExchangeScope,
): Promise<WithheldRows> {
  const result = Object.fromEntries(EXCHANGE_ENTITIES.map((entity) => [entity, new Set<string>()])) as WithheldRows;
  const cabinet = await db.organization.findUnique({ where: { id: masterOrganizationId }, select: { id: true, accountId: true } });
  if (!cabinet) return result;
  const links = await db.directoryExchangeLink.findMany({
    where: { masterOrganizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { entity: true, groupId: true, organizationId: true, entityId: true, hash: true, originOrganizationId: true, createdAt: true },
  });
  if (links.length === 0) return result;
  const known = await loadCompanies([
    ...links.map((link) => link.organizationId),
    ...links.map((link) => link.originOrganizationId).filter((id): id is string => Boolean(id)),
  ]);
  const companies: ExchangeCompanies = { owner: exchangeAccountKey(cabinet), of: companyLookup(known) };
  const looseKey = (entity: ExchangeEntity, row: EntityRow) => naturalKey(entity, row.fields, ENTITY_PARENT[entity] ? "*" : null, null);

  for (const entity of EXCHANGE_ENTITIES) {
    const entityLinks = links.filter((link) => link.entity === entity);
    if (entityLinks.length === 0) continue;
    const originOf = new Map<string, string>();
    for (const link of entityLinks) if (link.originOrganizationId && !originOf.has(link.groupId)) originOf.set(link.groupId, link.originOrganizationId);
    for (const [groupId, origin] of await legacyOriginsOf(entity, entityLinks, companies)) if (!originOf.has(groupId)) originOf.set(groupId, origin);

    const linkedSource = new Set<string>();
    /** Записи другой компании в группах этой компании или «смешанных»: организация → id. */
    const foreignRecords = new Map<string, Set<string>>();
    for (const link of entityLinks) {
      if (!link.entityId) continue;
      const origin = originOf.get(link.groupId) ?? null;
      if (link.organizationId === fromOrganizationId) {
        linkedSource.add(link.entityId);
        if (!companyReceivesGroup(origin, toCompany, companies)) result[entity].add(link.entityId);
        continue;
      }
      const company = companies.of(link.organizationId);
      if (company === companies.owner || company === toCompany) continue;
      if (origin !== MIXED_ORIGIN && (origin === null || companies.of(origin) !== company)) continue;
      const ids = foreignRecords.get(link.organizationId);
      if (ids) ids.add(link.entityId);
      else foreignRecords.set(link.organizationId, new Set([link.entityId]));
    }
    if (foreignRecords.size === 0) continue;

    const keys = new Set<string>();
    for (const [organizationId, ids] of foreignRecords) {
      for (const row of await loadEntityRows(entity, organizationId, undefined, scope)) {
        const key = ids.has(row.id) ? looseKey(entity, row) : null;
        if (key) keys.add(key);
      }
    }
    if (keys.size === 0) continue;
    for (const row of await loadEntityRows(entity, fromOrganizationId, undefined, scope)) {
      if (linkedSource.has(row.id)) continue;
      const key = looseKey(entity, row);
      if (key && keys.has(key)) result[entity].add(row.id);
    }
  }
  return result;
}

/** Не передаётся ли запись (`withheldTransferRows`); потомок закрытого родителя запоминается тоже. */
function isWithheld(withheld: WithheldRows | null, entity: ExchangeEntity, row: EntityRow): boolean {
  if (!withheld) return false;
  if (withheld[entity].has(row.id)) return true;
  const parent = ENTITY_PARENT[entity];
  if (!parent?.required || !row.parentId || !withheld[parent.entity].has(row.parentId)) return false;
  withheld[entity].add(row.id);
  return true;
}

/**
 * Что можно перенести из организации и что у получателя уже есть.
 * `crossAccount` — разрешить пару из разных аккаунтов (см. `loadTransferPair`);
 * без него чужая организация — 404, как раньше. С ним и `masterOrganizationId`
 * (кабинет запроса) записи групп другой компании не показываются (Р6.5).
 */
export async function transferPreview(input: {
  fromOrganizationId: string;
  toOrganizationId: string;
  crossAccount?: boolean;
  masterOrganizationId?: string | null;
  now?: Date;
}): Promise<TransferPreview> {
  const { to, scope, owners } = await loadTransferPair(input.fromOrganizationId, input.toOrganizationId, input.now ?? new Date(), {
    crossAccount: input.crossAccount,
  });
  const withheld =
    input.crossAccount && input.masterOrganizationId
      ? await withheldTransferRows(input.masterOrganizationId, input.fromOrganizationId, exchangeAccountKey(to), scope)
      : null;
  const state: TransferState = { toGroupOf: transferMaps(), toEntityOf: transferMaps() };
  const byEntity = new Map<ExchangeEntity, TransferItem[]>();
  // Люди и продукты, которых обмен «не видит» (с входом, в архиве, выключенные),
  // всё равно заняли своё имя: такие записи перенос пропустит — показываем их
  // уже существующими, а не обещаем создать.
  const [people, products] = await Promise.all([
    db.user.findMany({ where: { organizationId: input.toOrganizationId, isRoot: false }, select: { name: true } }),
    db.product.findMany({ where: { organizationId: input.toOrganizationId }, select: { name: true } }),
  ]);
  const takenNames: Partial<Record<ExchangeEntity, Set<string>>> = {
    staff: new Set(people.map((row) => normalizeExchangeName(row.name))),
    product: new Set(products.map((row) => normalizeExchangeName(row.name))),
  };
  for (const entity of EXCHANGE_ENTITIES) {
    const { fromRows, exists } = await matchTransferEntity(entity, input.fromOrganizationId, input.toOrganizationId, state, scope, owners);
    const parent = ENTITY_PARENT[entity];
    const taken = takenNames[entity];
    byEntity.set(
      entity,
      fromRows
        .filter((row) => row.key !== null && !isWithheld(withheld, entity, row))
        .map((row) => ({
          id: row.id,
          name: row.name,
          detail: row.detail,
          exists: exists.has(row.id) || Boolean(taken?.has(normalizeExchangeName(row.name))),
          entity,
          parentId: parent?.required ? row.parentId : null,
        })),
    );
  }
  // В списке родитель идёт перед своими записями: должность — перед людьми,
  // объект — перед помещениями, цех — перед оборудованием.
  const items = emptyKindRecord<TransferItem[]>(() => []);
  for (const kind of EXCHANGE_KINDS) {
    const [first, second] = KIND_ENTITIES[kind];
    const parents = byEntity.get(first) ?? [];
    const children = second ? byEntity.get(second) ?? [] : [];
    for (const item of parents) {
      items[kind].push(item, ...children.filter((child) => child.parentId === item.id));
    }
  }
  return { items };
}

/**
 * Разовый перенос выбранных записей из одной организации аккаунта в другую.
 * Связь не сохраняется; запись, которая у получателя уже есть (по
 * естественному ключу), пропускается и в итог не попадает; родители
 * подтягиваются сами. В итоге `updated` — только настройки журналов (Р8.1):
 * они у получателя есть всегда, и перенос заменяет их образцом. Что создано
 * (с зеркалами помещений и цехов) и что заменено (со снимком прежних
 * настроек журналов, серия D, Р10), запоминается в `DirectoryTransfer`:
 * владелец аккаунта получателя может отменить перенос в течение 7 дней
 * (transfer-undo.server.ts).
 *
 * `crossAccount` — разрешить пару из разных аккаунтов: его передаёт только
 * подтверждение запроса владельцем кабинета. Тогда `actor` — владелец
 * источника, сотрудники переносятся как ФИО и должность (Р5), а в журнал
 * получателя имя `actor` не пишется. Без параметра чужая организация — 404.
 * `masterOrganizationId` — кабинет запроса: записи, чья группа в нём начата
 * другой компанией, не передаются (Р6.5, `withheldTransferRows`).
 */
export async function transferOnce(input: {
  fromOrganizationId: string;
  toOrganizationId: string;
  selection: TransferSelection;
  actor: ExchangeActor;
  crossAccount?: boolean;
  masterOrganizationId?: string | null;
  /** Перенос по подтверждённому запросу другой компании — запоминается вместе с переносом. */
  requestId?: string | null;
  now?: Date;
}): Promise<ExchangeSummary> {
  const { fromOrganizationId, toOrganizationId, actor } = input;
  const { from, to, scope, owners } = await loadTransferPair(fromOrganizationId, toOrganizationId, input.now ?? new Date(), {
    crossAccount: input.crossAccount,
  });

  // Что выбрано по каждой сущности: всё или отмеченные записи.
  const wanted = new Map<ExchangeEntity, Set<string> | "all">();
  for (const kind of EXCHANGE_KINDS) {
    const chosen = input.selection[kind];
    if (!chosen || (chosen !== "all" && chosen.length === 0)) continue;
    for (const entity of KIND_ENTITIES[kind]) wanted.set(entity, chosen === "all" ? "all" : new Set(chosen));
  }
  if (wanted.size === 0) throw new DirectoryExchangeError("Выберите, что перенести", 400);

  // Родители отмеченных записей подтягиваются сами: должность сотрудника,
  // объект помещения, цех оборудования.
  for (const entity of [...EXCHANGE_ENTITIES].reverse()) {
    const parent = ENTITY_PARENT[entity];
    const chosen = wanted.get(entity);
    const parents = parent?.required ? wanted.get(parent.entity) : undefined;
    if (!chosen || chosen === "all" || !parents || parents === "all") continue;
    for (const row of await loadEntityRows(entity, fromOrganizationId, undefined, scope)) {
      if (chosen.has(row.id) && row.parentId) parents.add(row.parentId);
    }
  }

  const tally = new Tally();
  const notes = new Set<string>();
  const locked = await withAdvisoryTryLock(
    advisoryLockKey(TRANSFER_LOCK_PREFIX, toOrganizationId),
    async () => {
      // Что перенос создаёт — для отмены в течение 7 дней (серия B, п. 12).
      const record = await startTransferRecord(toOrganizationId);
      const withheld =
        input.crossAccount && input.masterOrganizationId
          ? await withheldTransferRows(input.masterOrganizationId, fromOrganizationId, exchangeAccountKey(to), scope)
          : null;
      const state: TransferState = { toGroupOf: transferMaps(), toEntityOf: transferMaps() };
      /** Не созданные записи источника → причина (для потомков). */
      const blocked = new Map<string, SkipReason>();
      for (const entity of EXCHANGE_ENTITIES) {
        const { fromRows, exists } = await matchTransferEntity(entity, fromOrganizationId, toOrganizationId, state, scope, owners);
        const chosen = wanted.get(entity);
        if (!chosen) continue;
        const kind = ENTITY_KIND[entity];
        const parent = ENTITY_PARENT[entity];
        const createdKeys = new Set<string>();
        for (const row of fromRows) {
          if (row.key === null || (chosen !== "all" && !chosen.has(row.id))) continue;
          // Записи групп другой компании этой компании не передаются (Р6.5).
          if (isWithheld(withheld, entity, row)) continue;
          // То, что у получателя уже есть, пропускается молча: окно переноса
          // показало такие записи заранее, в итог идут только отказы.
          if (exists.has(row.id) || createdKeys.has(row.key)) continue;
          if (isSingleRecordEntity(entity)) {
            // Настройки журналов (Р8.1): перенос заменяет настройки получателя
            // образцом — «обновлено». Прежние настройки запоминаются снимком:
            // отмена переноса вернёт их, если их потом не меняли (серия D, Р10).
            const target = state.toEntityOf[entity].get(row.id);
            let replaced: UpdateOutcome = { status: "missing" };
            let previous: EntityRow | undefined;
            try {
              if (target) {
                previous = (await loadEntityRows(entity, toOrganizationId, undefined, scope)).find((item) => item.id === target);
                replaced = await updateEntityRow(entity, toOrganizationId, target, row, undefined, { scope });
              }
            } catch (error) {
              console.error("[directory-exchange] transfer failed", { entity, toOrganizationId, error });
              notes.add("Часть записей не удалось перенести из-за ошибки — повторите перенос.");
              replaced = { status: "conflict" };
            }
            if (replaced.status === "updated" && target) {
              createdKeys.add(row.key);
              tally.updated(toOrganizationId, kind);
              await record.created(entity, target);
              if (previous) record.replaced(entity, target, previous.fields);
            } else if (replaced.status === "conflict" || replaced.status === "limit") {
              tally.skipped(toOrganizationId, kind, replaced.status, `${entity}|${row.id}`);
            }
            continue;
          }
          let parentId: string | null = null;
          if (parent?.required) {
            const known = row.parentId ? state.toEntityOf[parent.entity].get(row.parentId) : undefined;
            if (!known) {
              const reason = (row.parentId ? blocked.get(row.parentId) : undefined) ?? "conflict";
              blocked.set(row.id, reason);
              tally.skipped(toOrganizationId, kind, reason, `${entity}|${row.id}`);
              continue;
            }
            parentId = known;
          } else if (parent && row.parentGroupId) {
            parentId = state.toEntityOf[parent.entity].get(row.parentGroupId) ?? null;
          }

          let outcome: CreateOutcome;
          try {
            outcome = await createEntityRow(entity, toOrganizationId, row, parentId, { scope });
          } catch (error) {
            console.error("[directory-exchange] transfer failed", { entity, toOrganizationId, error });
            notes.add("Часть записей не удалось перенести из-за ошибки — повторите перенос.");
            outcome = { status: "conflict" };
          }
          if (outcome.status === "created") {
            state.toEntityOf[entity].set(row.id, outcome.id);
            state.toGroupOf[entity].set(outcome.id, row.id);
            createdKeys.add(row.key);
            tally.created(toOrganizationId, kind);
            await record.created(entity, outcome.id);
          } else {
            blocked.set(row.id, outcome.status);
            tally.skipped(toOrganizationId, kind, outcome.status, `${entity}|${row.id}`);
          }
        }
      }
      // Отпечатки созданного — ещё под замком: по ним отмена увидит правку после переноса.
      await record.fingerprint();
      return record;
    },
    { attempts: 16, delayMs: 250, timeoutMs: RUN_TIMEOUT_MS },
  );
  if (!locked.acquired) throw new DirectoryExchangeError(BUSY_MESSAGE, 409, EXCHANGE_BUSY_CODE);

  const kinds = tally.kindsOf(toOrganizationId);
  const summary: ExchangeSummary = {
    organizations: [{ organizationId: to.id, name: to.name, kinds }],
    notes: [...notes],
  };
  await locked.value.save({
    fromOrganizationId: from.id,
    // Название другой компании получателю не запоминается (Р5).
    fromOrganizationName: scope === "foreign" ? null : from.name,
    toOrganizationId: to.id,
    actorUserId: actor.userId,
    requestId: input.requestId ?? null,
    summary,
  });
  const received = {
    toOrganizationId: to.id,
    toOrganizationName: to.name,
    lists: EXCHANGE_KINDS.filter((kind) => input.selection[kind] !== undefined),
    kinds: kinds as unknown as Prisma.InputJsonObject,
    ...(scope === "foreign" ? { crossAccount: true } : {}),
  };
  const details = { fromOrganizationId: from.id, fromOrganizationName: from.name, ...received };
  // В журнале обеих сторон: куда пришли данные и откуда их взяли. Между
  // аккаунтами перенос запускает владелец источника — получателю чужие и он
  // сам, и его организация: в журнал получателя не пишутся ни имя, ни
  // название и id источника.
  await writeAudit({
    organizationId: to.id,
    actor: scope === "foreign" ? null : actor,
    action: "directory_exchange.transferred",
    details: scope === "foreign" ? received : details,
  });
  await writeAudit({ organizationId: from.id, actor, action: "directory_exchange.transferred", details });
  return summary;
}
