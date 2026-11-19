import { isInactivePlan } from "@/lib/plan-limits";
import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { db } from "@/lib/db";
import {
  createEntityRow,
  loadEntityRows,
  updateEntityRow,
  type CreateOutcome,
  type EntityRow,
  type ParentGroupLookup,
  type UpdateOutcome,
} from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import {
  ENTITY_KIND,
  ENTITY_PARENT,
  EXCHANGE_ENTITIES,
  EXCHANGE_KINDS,
  KIND_ENTITIES,
  emptyKindRecord,
  normalizeExchangeKinds,
  type ExchangeEntity,
  type ExchangeKind,
  normalizeExchangeName,
} from "@/lib/directory-exchange/kinds";
import { planEntityExchange, type ExchangeLinkRow } from "@/lib/directory-exchange/plan";
import {
  emptyKindCounters,
  summaryTotals,
  type ExchangeCounters,
  type ExchangeSummary,
} from "@/lib/directory-exchange/summary";
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
type Participant = { organizationId: string; name: string; kinds: readonly ExchangeKind[] };
type LinkWrite = { groupId: string; organizationId: string; entityId: string | null; hash: string };

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
 * обновлённых записей.
 */
async function exchangeEntity(params: {
  masterOrganizationId: string;
  entity: ExchangeEntity;
  participants: readonly Participant[];
  tally: Tally;
  /** Не созданные записи: «сущность|группа|организация» → причина (для потомков). */
  blocked: Map<string, SkipReason>;
  notes: Set<string>;
}): Promise<number> {
  const { masterOrganizationId, entity, participants, tally, blocked, notes } = params;
  const kind = ENTITY_KIND[entity];
  const parent = ENTITY_PARENT[entity];
  const organizationIds = participants.map((participant) => participant.organizationId);
  const sharesObjects = new Set(
    participants.filter((participant) => participant.kinds.includes("objects")).map((participant) => participant.organizationId),
  );

  const [links, parentLinks] = await Promise.all([
    db.directoryExchangeLink.findMany({
      where: { masterOrganizationId, entity, organizationId: { in: organizationIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { groupId: true, organizationId: true, entityId: true, hash: true },
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

  const rows: Record<string, EntityRow[]> = {};
  const rowIndex = new Map<string, Map<string, EntityRow>>();
  for (const organizationId of organizationIds) {
    rows[organizationId] = await loadEntityRows(entity, organizationId, lookupFor(organizationId));
    rowIndex.set(organizationId, new Map(rows[organizationId].map((row) => [row.id, row])));
  }

  const ops = planEntityExchange({ participants: organizationIds, rows, links, newGroupId: randomUUID });
  if (ops.length === 0) return 0;

  const linkKey = (groupId: string, organizationId: string) => `${groupId}\u0000${organizationId}`;
  const stored = new Map<string, ExchangeLinkRow>(links.map((link) => [linkKey(link.groupId, link.organizationId), link]));
  const writes = new Map<string, LinkWrite>();
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
        changes += 1;
      } else {
        blocked.set(`${skipKey}|${op.organizationId}`, outcome.status);
        tally.skipped(op.organizationId, kind, outcome.status, skipKey);
      }
      continue;
    }

    // update: родителя меняем, только когда у образца он другой и здесь он есть.
    const target = rowIndex.get(op.organizationId)?.get(op.entityId);
    const parentId =
      parent && typeof knownParent === "string" && target?.parentGroupId !== parentGroupId ? knownParent : undefined;
    let outcome: UpdateOutcome;
    try {
      outcome = await updateEntityRow(entity, op.organizationId, op.entityId, source, parentId);
    } catch (error) {
      console.error("[directory-exchange] update failed", { entity, organizationId: op.organizationId, error });
      notes.add(FAILED_NOTE);
      outcome = { status: "conflict" };
    }
    if (outcome.status === "updated") {
      writes.set(key, { groupId: op.groupId, organizationId: op.organizationId, entityId: op.entityId, hash: op.hash });
      touch(op.organizationId, op.entityId);
      tally.updated(op.organizationId, kind);
      changes += 1;
    } else {
      failedGroups.add(op.groupId);
      if (fresh.has(key)) writes.delete(key);
      if (outcome.status === "conflict") tally.skipped(op.organizationId, kind, "conflict", skipKey);
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
  for (const [organizationId, ids] of touched) {
    const actual = new Map((await loadEntityRows(entity, organizationId, lookupFor(organizationId))).map((row) => [row.id, row]));
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
      data: inserts.map((write) => ({ masterOrganizationId, entity, ...write })),
      skipDuplicates: true,
    });
  }
  return changes;
}

async function exchangeUnderLock(
  masterOrganizationId: string,
  actor: ExchangeActor | null,
  now: Date,
): Promise<ExchangeSummary> {
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
      organization: { select: { id: true, name: true, accountId: true, isDemo: true, kind: true, subscriptionPlan: true } },
    },
  });

  const notes = new Set<string>();
  const participants: Participant[] = [];
  for (const member of members) {
    const organization = member.organization;
    const kinds = normalizeExchangeKinds(member.kinds);
    if (kinds.length === 0) continue;
    // Только организации аккаунта кабинета; демо и сами кабинеты — никогда.
    if (organization.accountId !== cabinet.accountId || organization.isDemo || organization.kind === MASTER_ORG_KIND) continue;
    // На паузе или отменена — как и остальная автоматика, обмен её не трогает.
    if (isInactivePlan(organization.subscriptionPlan)) continue;
    if (await isOrganizationLocked(organization.id, now)) {
      notes.add(`Организация «${organization.name}» закрыта до оплаты точки и в обмене не участвовала.`);
      continue;
    }
    participants.push({ organizationId: organization.id, name: organization.name, kinds });
  }

  const tally = new Tally();
  const blocked = new Map<string, SkipReason>();
  if (participants.length >= 2) {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let changes = 0;
      for (const entity of EXCHANGE_ENTITIES) {
        const sharing = participants.filter((participant) => participant.kinds.includes(ENTITY_KIND[entity]));
        if (sharing.length < 2) continue;
        changes += await exchangeEntity({ masterOrganizationId, entity, participants: sharing, tally, blocked, notes });
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

  await db.directoryExchangeMember.updateMany({
    where: { masterOrganizationId },
    data: { lastSyncedAt: now, lastSyncJson: summary as unknown as Prisma.InputJsonObject },
  });
  for (const organization of summary.organizations) {
    if (!hasCounters(organization.kinds)) continue;
    await writeAudit({
      organizationId: organization.organizationId,
      actor,
      action: "directory_exchange.synced",
      details: {
        masterOrganizationId,
        trigger: actor ? "manual" : "schedule",
        kinds: organization.kinds as unknown as Prisma.InputJsonObject,
      },
    });
  }
  return summary;
}

/**
 * Обмен справочниками кабинета: участники — организации аккаунта кабинета с
 * отмеченными списками, кроме закрытых после своих 14 дней. Одновременно
 * идёт один обмен на кабинет; занято — `DirectoryExchangeError` 409.
 * `actor` — кто запустил вручную; без него обмен считается плановым.
 */
export async function runDirectoryExchange(
  masterOrganizationId: string,
  options: { actor?: ExchangeActor; now?: Date } = {},
): Promise<ExchangeSummary> {
  const now = options.now ?? new Date();
  const locked = await withAdvisoryTryLock(
    advisoryLockKey(LOCK_PREFIX, masterOrganizationId),
    () => exchangeUnderLock(masterOrganizationId, options.actor ?? null, now),
    // Человек ждёт несколько секунд, плановый обмен занятый кабинет пропускает.
    { attempts: options.actor ? 16 : 1, delayMs: 250, timeoutMs: RUN_TIMEOUT_MS },
  );
  if (!locked.acquired) throw new DirectoryExchangeError(BUSY_MESSAGE, 409, EXCHANGE_BUSY_CODE);
  return locked.value;
}

/** Плановый обмен: каждый кабинет с двумя и более участниками; сбой одного не мешает остальным. */
export async function runAllDirectoryExchanges(options: { now?: Date } = {}): Promise<ExchangeBatchResult> {
  const result: ExchangeBatchResult = { cabinets: 0, busy: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  const groups = await db.directoryExchangeMember.groupBy({ by: ["masterOrganizationId"], _count: { _all: true } });
  for (const group of groups) {
    if (group._count._all < 2) continue;
    result.cabinets += 1;
    try {
      const totals = summaryTotals(await runDirectoryExchange(group.masterOrganizationId, { now: options.now }));
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
  return {
    position: new Map(),
    staff: new Map(),
    building: new Map(),
    room: new Map(),
    area: new Map(),
    equipment: new Map(),
    product: new Map(),
  };
}

/** Обе организации — рабочие организации одного аккаунта, ни одна не закрыта. */
async function loadTransferPair(fromOrganizationId: string, toOrganizationId: string, now: Date) {
  if (fromOrganizationId === toOrganizationId) throw new DirectoryExchangeError("Выберите другую организацию", 400);
  const organizations = await db.organization.findMany({
    where: { id: { in: [fromOrganizationId, toOrganizationId] }, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
    select: { id: true, name: true, accountId: true },
  });
  const from = organizations.find((organization) => organization.id === fromOrganizationId);
  const to = organizations.find((organization) => organization.id === toOrganizationId);
  if (!from || !to || !from.accountId || from.accountId !== to.accountId) {
    throw new DirectoryExchangeError("Организация не найдена", 404);
  }
  for (const organization of [to, from]) {
    if (await isOrganizationLocked(organization.id, now)) {
      throw new DirectoryExchangeError(ORG_LOCKED_MESSAGE, 409, ORG_LOCKED_CODE);
    }
  }
  return { from, to };
}

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
    loadEntityRows(entity, fromOrganizationId, fromLookup),
    loadEntityRows(entity, toOrganizationId, toLookup),
  ]);
  const toByKey = new Map<string, EntityRow>();
  for (const row of toRows) if (row.key !== null && !toByKey.has(row.key)) toByKey.set(row.key, row);
  const exists = new Set<string>();
  for (const row of fromRows) {
    const match = row.key === null ? undefined : toByKey.get(row.key);
    if (!match) continue;
    exists.add(row.id);
    state.toEntityOf[entity].set(row.id, match.id);
    if (!state.toGroupOf[entity].has(match.id)) state.toGroupOf[entity].set(match.id, row.id);
  }
  return { fromRows, exists };
}

/** Что можно перенести из организации и что у получателя уже есть. */
export async function transferPreview(input: {
  fromOrganizationId: string;
  toOrganizationId: string;
  now?: Date;
}): Promise<TransferPreview> {
  await loadTransferPair(input.fromOrganizationId, input.toOrganizationId, input.now ?? new Date());
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
    const { fromRows, exists } = await matchTransferEntity(entity, input.fromOrganizationId, input.toOrganizationId, state);
    const parent = ENTITY_PARENT[entity];
    const taken = takenNames[entity];
    byEntity.set(
      entity,
      fromRows
        .filter((row) => row.key !== null)
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
 * подтягиваются сами. В итоге `updated` всегда 0.
 */
export async function transferOnce(input: {
  fromOrganizationId: string;
  toOrganizationId: string;
  selection: TransferSelection;
  actor: ExchangeActor;
  now?: Date;
}): Promise<ExchangeSummary> {
  const { fromOrganizationId, toOrganizationId, actor } = input;
  const { from, to } = await loadTransferPair(fromOrganizationId, toOrganizationId, input.now ?? new Date());

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
    for (const row of await loadEntityRows(entity, fromOrganizationId)) {
      if (chosen.has(row.id) && row.parentId) parents.add(row.parentId);
    }
  }

  const tally = new Tally();
  const notes = new Set<string>();
  const locked = await withAdvisoryTryLock(
    advisoryLockKey(TRANSFER_LOCK_PREFIX, toOrganizationId),
    async () => {
      const state: TransferState = { toGroupOf: transferMaps(), toEntityOf: transferMaps() };
      /** Не созданные записи источника → причина (для потомков). */
      const blocked = new Map<string, SkipReason>();
      for (const entity of EXCHANGE_ENTITIES) {
        const { fromRows, exists } = await matchTransferEntity(entity, fromOrganizationId, toOrganizationId, state);
        const chosen = wanted.get(entity);
        if (!chosen) continue;
        const kind = ENTITY_KIND[entity];
        const parent = ENTITY_PARENT[entity];
        const createdKeys = new Set<string>();
        for (const row of fromRows) {
          if (row.key === null || (chosen !== "all" && !chosen.has(row.id))) continue;
          // То, что у получателя уже есть, пропускается молча: окно переноса
          // показало такие записи заранее, в итог идут только отказы.
          if (exists.has(row.id) || createdKeys.has(row.key)) continue;
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
            outcome = await createEntityRow(entity, toOrganizationId, row, parentId);
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
          } else {
            blocked.set(row.id, outcome.status);
            tally.skipped(toOrganizationId, kind, outcome.status, `${entity}|${row.id}`);
          }
        }
      }
    },
    { attempts: 16, delayMs: 250, timeoutMs: RUN_TIMEOUT_MS },
  );
  if (!locked.acquired) throw new DirectoryExchangeError(BUSY_MESSAGE, 409, EXCHANGE_BUSY_CODE);

  const kinds = tally.kindsOf(toOrganizationId);
  const summary: ExchangeSummary = {
    organizations: [{ organizationId: to.id, name: to.name, kinds }],
    notes: [...notes],
  };
  const details = {
    fromOrganizationId: from.id,
    fromOrganizationName: from.name,
    toOrganizationId: to.id,
    toOrganizationName: to.name,
    lists: EXCHANGE_KINDS.filter((kind) => input.selection[kind] !== undefined),
    kinds: kinds as unknown as Prisma.InputJsonObject,
  };
  // В журнале обеих сторон: куда пришли данные и откуда их взяли.
  await writeAudit({ organizationId: to.id, actor, action: "directory_exchange.transferred", details });
  await writeAudit({ organizationId: from.id, actor, action: "directory_exchange.transferred", details });
  return summary;
}
