import type { Prisma } from "@prisma/client";

import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { db } from "@/lib/db";
import {
  exchangeRowFromFields,
  loadEntityRows,
  updateEntityRow,
  type ParentGroupLookup,
} from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_PAUSED_MESSAGE, isExchangePaused } from "@/lib/directory-exchange/pause";
import {
  CHANGE_CONFLICT_MESSAGE,
  CHANGE_EXPIRED_MESSAGE,
  CHANGE_LIMIT_MESSAGE,
  CHANGE_MISSING_MESSAGE,
  CHANGE_NO_BEFORE_MESSAGE,
  CHANGE_NOT_FOUND_MESSAGE,
  CHANGE_UNDONE_MESSAGE,
  ExchangeChangeKeptError,
  HISTORY_MS,
  historySource,
  isChangeOp,
  parseChangeSnapshot,
  type ChangeOp,
  type ChangeSnapshot,
  type HistorySource,
} from "@/lib/directory-exchange/history";
import {
  ENTITY_KIND,
  ENTITY_PARENT,
  currentFieldVersion,
  hashScope,
  hashTag,
  isExchangeEntity,
  rowHashLike,
  type ExchangeEntity,
  type ExchangeKind,
} from "@/lib/directory-exchange/kinds";
import {
  currentHashes,
  exchangeCabinetsOf,
  undoCreated,
  underExchangeLocks,
} from "@/lib/directory-exchange/transfer-undo.server";
import { emptyTransferCreated, emptyTransferHashes, type UndoAction } from "@/lib/directory-exchange/transfer-undo";
import { syncFryerOilDocumentsSafe } from "@/lib/fryer-oil-equipment-sync";

/**
 * История обмена по организации (серия D, Р5): что обмен создал или изменил
 * у организации (`DirectoryExchangeChange`, пишет `exchangeEntity` в
 * run.server.ts), список за 30 дней и отмена одного изменения.
 *
 * Отмена — владелец аккаунта ЭТОЙ организации, один раз (повтор — 409):
 *   • созданное — по правилам отмены переноса (`undoCreated`): используемое и
 *     правленное остаётся с причиной; отменённое получает надгробие в
 *     таблице соответствий кабинета — обмен не создаст запись снова;
 *   • изменённое — прежние значения возвращаются только у этой организации
 *     (`updateEntityRow` с образцом из `beforeJson`), а связь получает
 *     отпечаток вернувшейся записи — посчитанный так же, как его считает
 *     обмен: правка не уходит обратно к остальным, а следующая правка
 *     источника придёт снова. Так же возвращаются настройки журналов.
 *     Запись правили после обмена — остаётся как есть (`edited`). Если
 *     организация в том же списке участвует ещё в одном кабинете (свой
 *     кабинет аккаунта и кабинет другой компании), там связь тоже получает
 *     отпечаток вернувшейся записи — если она видела запись «после обмена»;
 *     иначе тот кабинет разнёс бы прежние значения соседям.
 *   • зеркало созданного помещения (цех) или цеха (помещение) убирается,
 *     только если его завело само это создание (`afterJson.mirrorId`), и по
 *     тем же правилам; у изменений без отметки зеркало не трогается.
 *
 * Отмена идёт под замками обмена кабинетов организации (и кабинета изменения)
 * и под замком переноса в организацию — как отмена переноса.
 */

const TRANSFER_LOCK_PREFIX = "directory-transfer";
const TRANSFER_BUSY_MESSAGE = "Перенос или отмена уже выполняются. Подождите минуту и повторите.";
const LOCK_WAIT = { attempts: 16, delayMs: 250, timeoutMs: 180_000 } as const;
const LIST_LIMIT = 100;
/** Родитель строки — он сам: как у отпечатков отмены переноса. */
const OWN_PARENT: ParentGroupLookup = (parentId) => parentId;

/* ───────────────────────── запись ───────────────────────── */

export type ExchangeChangeRecord = {
  runId: string | null;
  masterOrganizationId: string;
  organizationId: string;
  entity: ExchangeEntity;
  entityId: string;
  groupId: string;
  op: ChangeOp;
  sourceOrganizationId: string | null;
  name: string;
  before: ChangeSnapshot | null;
  after: ChangeSnapshot | null;
};

/** Записать изменения одной пачкой; сбой — только в лог, обмен идёт дальше. */
export async function recordExchangeChanges(changes: readonly ExchangeChangeRecord[]): Promise<void> {
  if (changes.length === 0) return;
  const json = (value: ChangeSnapshot | null) => (value ? (value as unknown as Prisma.InputJsonObject) : undefined);
  try {
    for (let index = 0; index < changes.length; index += 500) {
      await db.directoryExchangeChange.createMany({
        data: changes.slice(index, index + 500).map((change) => ({
          runId: change.runId,
          masterOrganizationId: change.masterOrganizationId,
          organizationId: change.organizationId,
          entity: change.entity,
          entityId: change.entityId,
          groupId: change.groupId,
          op: change.op,
          sourceOrganizationId: change.sourceOrganizationId,
          name: change.name.slice(0, 300),
          beforeJson: json(change.before),
          afterJson: json(change.after),
        })),
      });
    }
  } catch (error) {
    console.error("[directory-exchange] history not recorded", { count: changes.length, error });
  }
}

/* ───────────────────────── список ───────────────────────── */

export type ExchangeHistoryItem = {
  id: string;
  createdAt: string;
  entity: ExchangeEntity;
  kind: ExchangeKind;
  op: ChangeOp;
  /** Название записи после обмена; у настроек журналов — пусто. */
  name: string;
  /** Откуда: своя организация — по названию; у компании другого аккаунта — только мастер-кабинет. */
  from: HistorySource;
  undoneAt: string | null;
  /** Ещё не отменено. Правили ли запись и используется ли она, отмена проверит сама. */
  undoable: boolean;
};

/**
 * Изменения обмена у организации за 30 дней, новые первыми. Вызывающий
 * проверил, что смотрит владелец её аккаунта (`requireExchangeOwner`).
 */
export async function listExchangeHistory(
  owner: { organizationId: string },
  options: { now?: Date; limit?: number } = {},
): Promise<ExchangeHistoryItem[]> {
  const now = options.now ?? new Date();
  const viewer = await db.organization.findUnique({ where: { id: owner.organizationId }, select: { accountId: true } });
  if (!viewer) return [];
  const rows = await db.directoryExchangeChange.findMany({
    where: { organizationId: owner.organizationId, createdAt: { gte: new Date(now.getTime() - HISTORY_MS) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(1, Math.min(options.limit ?? LIST_LIMIT, 200)),
    select: {
      id: true,
      createdAt: true,
      entity: true,
      op: true,
      name: true,
      masterOrganizationId: true,
      sourceOrganizationId: true,
      undoneAt: true,
    },
  });
  const orgIds = [
    ...new Set([
      ...rows.map((row) => row.masterOrganizationId),
      ...rows.map((row) => row.sourceOrganizationId).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const organizations = orgIds.length
    ? new Map(
        (await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, accountId: true } })).map((row) => [
          row.id,
          row,
        ]),
      )
    : new Map<string, { id: string; name: string; accountId: string | null }>();

  const items: ExchangeHistoryItem[] = [];
  for (const row of rows) {
    if (!isExchangeEntity(row.entity) || !isChangeOp(row.op)) continue;
    const cabinet = organizations.get(row.masterOrganizationId) ?? { name: "", accountId: null };
    const source = row.sourceOrganizationId ? organizations.get(row.sourceOrganizationId) ?? null : null;
    items.push({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      entity: row.entity,
      kind: ENTITY_KIND[row.entity],
      op: row.op,
      name: row.name,
      from: historySource({ viewerAccountId: viewer.accountId, cabinet, source }),
      undoneAt: row.undoneAt?.toISOString() ?? null,
      undoable: !row.undoneAt,
    });
  }
  return items;
}

/* ───────────────────────── отмена ───────────────────────── */

export type ExchangeChangeUndoResult = {
  op: ChangeOp;
  /** Что сделано: созданное удалено, в архиве или выключено (`none` — записи уже не было); изменённое — `restored`. */
  action: UndoAction | "none";
};

/**
 * `fn` под замками обмена кабинетов организации и кабинетов `extraCabinetIds`
 * (кабинет изменения, кабинеты со связями записи; по id, по порядку) и под
 * замком переноса в организацию — порядок тот же, что у отмены переноса,
 * круга ожидания нет.
 */
async function underOrganizationLocks<T>(
  organizationId: string,
  accountId: string,
  extraCabinetIds: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const cabinets = [...new Set([...(await exchangeCabinetsOf(organizationId, accountId)), ...extraCabinetIds])].sort();
  return underExchangeLocks(cabinets, async () => {
    const locked = await withAdvisoryTryLock(advisoryLockKey(TRANSFER_LOCK_PREFIX, organizationId), fn, LOCK_WAIT);
    if (!locked.acquired) throw new DirectoryExchangeError(TRANSFER_BUSY_MESSAGE, 409, "transfer_busy");
    return locked.value;
  });
}

type ChangeRow = {
  id: string;
  masterOrganizationId: string;
  organizationId: string;
  entity: ExchangeEntity;
  entityId: string;
  groupId: string;
  createdAt: Date;
  beforeJson: Prisma.JsonValue;
  afterJson: Prisma.JsonValue;
};

/** Надгробие связи организации в группе: обмен эту запись здесь больше не создаёт. */
async function tombstoneLink(tx: Prisma.TransactionClient, change: ChangeRow): Promise<void> {
  const where = {
    masterOrganizationId: change.masterOrganizationId,
    entity: change.entity,
    groupId: change.groupId,
    organizationId: change.organizationId,
  };
  const updated = await tx.directoryExchangeLink.updateMany({ where, data: { entityId: null } });
  if (updated.count > 0) return;
  // Связи нет (организацию выводили из обмена): надгробие пишется заново, с отметкой группы.
  const origin = await tx.directoryExchangeLink.findFirst({
    where: { masterOrganizationId: change.masterOrganizationId, entity: change.entity, groupId: change.groupId, originOrganizationId: { not: null } },
    select: { originOrganizationId: true },
  });
  await tx.directoryExchangeLink.create({ data: { ...where, entityId: null, hash: "", originOrganizationId: origin?.originOrganizationId ?? null } });
}

/** Отменить созданное обменом: правила отмены переноса и надгробие связи. */
async function undoCreatedChange(change: ChangeRow, actorUserId: string, now: Date): Promise<ExchangeChangeUndoResult> {
  const { organizationId, entity, entityId } = change;
  const after = parseChangeSnapshot(change.afterJson);
  const hashed = emptyTransferCreated();
  hashed[entity] = [entityId];
  const stored = emptyTransferHashes();
  if (after?.hash) stored[entity][entityId] = after.hash;
  const current = await currentHashes(organizationId, after?.hash ? hashed : emptyTransferCreated(), stored);
  // Зеркало, которое завело само это создание (цех помещения, помещение цеха), идёт парой —
  // те же правила, что у переноса: используется одно — остаются оба (`linked`).
  const created = emptyTransferCreated();
  created[entity] = [entityId];
  if (after?.mirrorId && (entity === "room" || entity === "area")) created[entity === "room" ? "area" : "room"] = [after.mirrorId];

  const outcome = await db.$transaction(
    async (tx) => {
      const claimed = await tx.directoryExchangeChange.updateMany({
        where: { id: change.id, undoneAt: null },
        data: { undoneAt: now, undoneByUserId: actorUserId },
      });
      if (claimed.count === 0) throw new DirectoryExchangeError(CHANGE_UNDONE_MESSAGE, 409, "change_undone");
      const result = await undoCreated(tx, { organizationId, created, transferAt: change.createdAt, now, hashes: { stored, current } });
      // Запись осталась (правили, используется, внутри что-то есть) — ничего не меняем, отметка снимается.
      const kept = result.result.kept.find((item) => item.entity === entity && item.id === entityId);
      if (kept) throw new ExchangeChangeKeptError(kept.reason);
      await tombstoneLink(tx, change);
      return result;
    },
    { maxWait: 10_000, timeout: 120_000 },
  );

  // Удалённая фритюрница уходит из журнала фритюра (как при удалении руками).
  const undone = outcome.result.undone.find((item) => item.entity === entity && item.id === entityId);
  if (outcome.fryersRemoved) await syncFryerOilDocumentsSafe(organizationId);
  return { op: "create", action: undone?.action ?? "none" };
}

/** Группы родителей в своей организации — как их видит обмен кабинета (`lookupFor` в run.server.ts). */
async function parentGroupLookup(masterOrganizationId: string, entity: ExchangeEntity, organizationId: string): Promise<ParentGroupLookup> {
  const parent = ENTITY_PARENT[entity];
  if (!parent) return () => null;
  const links = await db.directoryExchangeLink.findMany({
    where: { masterOrganizationId, entity: parent.entity, organizationId, entityId: { not: null } },
    select: { groupId: true, entityId: true },
  });
  const groups = new Map(links.map((link) => [link.entityId as string, link.groupId]));
  return (id) => groups.get(id) ?? null;
}

/** Вернуть прежние значения изменённой записи только у этой организации. */
async function undoUpdatedChange(change: ChangeRow, actorUserId: string, now: Date): Promise<ExchangeChangeUndoResult> {
  const { organizationId, entity, entityId } = change;
  const before = parseChangeSnapshot(change.beforeJson);
  const after = parseChangeSnapshot(change.afterJson);
  // Снимок другой версии состава полей (Р8.0) вернул бы новые поля пустыми — такую правку не трогаем.
  if (!before || !before.hash || hashTag(before.hash).version !== currentFieldVersion(entity)) {
    throw new DirectoryExchangeError(CHANGE_NO_BEFORE_MESSAGE, 409, "change_not_undoable");
  }

  const row = (await loadEntityRows(entity, organizationId, OWN_PARENT)).find((item) => item.id === entityId);
  if (!row) throw new DirectoryExchangeError(CHANGE_MISSING_MESSAGE, 409, "change_missing");
  // Правили после обмена (руками или следующим обменом) — прежние значения затёрли бы правку.
  if (after?.hash) {
    const currentHash = rowHashLike(entity, row.fields, row.parentGroupId, after.hash) ?? row.hash;
    if (currentHash !== after.hash) throw new ExchangeChangeKeptError("edited");
  }

  // Связи записи во всех кабинетах, которые видят её такой, какой её оставил обмен:
  // отпечаток связи совпадает с записью сейчас (в составе и версии связи, родитель —
  // группа этого кабинета). Только им после возврата нужен новый отпечаток.
  const seenAsAfter: Array<{ masterOrganizationId: string; groupId: string; hash: string; lookup: ParentGroupLookup }> = [];
  const links = await db.directoryExchangeLink.findMany({
    where: { organizationId, entity, entityId },
    select: { masterOrganizationId: true, groupId: true, hash: true },
  });
  for (const link of links) {
    const lookup = await parentGroupLookup(link.masterOrganizationId, entity, organizationId);
    const seen = (await loadEntityRows(entity, organizationId, lookup)).find((item) => item.id === entityId);
    if (seen && rowHashLike(entity, seen.fields, seen.parentGroupId, link.hash) === link.hash) seenAsAfter.push({ ...link, lookup });
  }

  const parent = ENTITY_PARENT[entity];
  const parentId = parent && before.parentId && before.parentId !== row.parentId ? before.parentId : undefined;
  const source = exchangeRowFromFields(entity, { id: entityId, fields: before.fields, parentId: before.parentId }, before.scope);
  const outcome = await updateEntityRow(entity, organizationId, entityId, source, parentId, { scope: before.scope });
  if (outcome.status === "missing") throw new DirectoryExchangeError(CHANGE_MISSING_MESSAGE, 409, "change_missing");
  if (outcome.status === "limit") throw new DirectoryExchangeError(CHANGE_LIMIT_MESSAGE, 409, "change_limit");
  if (outcome.status !== "updated") throw new DirectoryExchangeError(CHANGE_CONFLICT_MESSAGE, 409, "change_conflict");

  // Связи — с отпечатком вернувшейся записи в том составе, в каком связь видел обмен
  // (как его пишет обмен: нынешняя версия, группы родителей кабинета): запись «не
  // изменена», правка не уходит к остальным ни в кабинете изменения, ни в других.
  for (const link of seenAsAfter) {
    const restored = (await loadEntityRows(entity, organizationId, link.lookup, hashScope(entity, link.hash))).find((item) => item.id === entityId);
    if (!restored) continue;
    await db.directoryExchangeLink.update({
      where: {
        masterOrganizationId_entity_groupId_organizationId: { masterOrganizationId: link.masterOrganizationId, entity, groupId: link.groupId, organizationId },
      },
      data: { hash: restored.hash },
    });
  }
  await db.directoryExchangeChange.updateMany({
    where: { id: change.id, undoneAt: null },
    data: { undoneAt: now, undoneByUserId: actorUserId },
  });
  return { op: "update", action: "restored" };
}

/**
 * Отменить одно изменение обмена. Только владелец аккаунта организации, у
 * которой оно было: чужое и несуществующее — одно и то же 404. Уже отменено
 * или старше 30 дней — 409; идёт обмен или перенос — 409; запись правили или
 * она используется — 409 `change_kept` с причиной, изменение не отмечается.
 */
export async function undoExchangeChange(input: {
  id: string;
  actor: { userId: string; userName: string | null };
  now?: Date;
}): Promise<ExchangeChangeUndoResult> {
  // Пауза обмена (откат версий отпечатка): отмена пишет связи — не во время паузы (`pause.ts`).
  if (isExchangePaused()) throw new DirectoryExchangeError(EXCHANGE_PAUSED_MESSAGE, 409);
  const now = input.now ?? new Date();
  const found = await db.directoryExchangeChange.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      masterOrganizationId: true,
      organizationId: true,
      entity: true,
      entityId: true,
      groupId: true,
      op: true,
      name: true,
      createdAt: true,
      undoneAt: true,
      beforeJson: true,
      afterJson: true,
      sourceOrganizationId: true,
      organization: { select: { accountId: true, account: { select: { ownerUserId: true } } } },
    },
  });
  const accountId = found?.organization.accountId;
  if (!found || !accountId || found.organization.account?.ownerUserId !== input.actor.userId) {
    throw new DirectoryExchangeError(CHANGE_NOT_FOUND_MESSAGE, 404);
  }
  const entity = found.entity;
  const op = found.op;
  if (!isExchangeEntity(entity) || !isChangeOp(op)) throw new DirectoryExchangeError(CHANGE_NOT_FOUND_MESSAGE, 404);
  if (found.undoneAt) throw new DirectoryExchangeError(CHANGE_UNDONE_MESSAGE, 409, "change_undone");
  if (now.getTime() - found.createdAt.getTime() > HISTORY_MS) throw new DirectoryExchangeError(CHANGE_EXPIRED_MESSAGE, 409, "change_expired");
  const change: ChangeRow = { ...found, entity };
  // Кабинеты, где у записи есть связь, — тоже под замки: их связи отмена может поправить.
  const linkedCabinets = await db.directoryExchangeLink.findMany({
    where: { organizationId: found.organizationId, entity, entityId: found.entityId },
    select: { masterOrganizationId: true },
  });

  const result = await underOrganizationLocks(
    found.organizationId,
    accountId,
    [found.masterOrganizationId, ...linkedCabinets.map((link) => link.masterOrganizationId)],
    async () => {
      // Под замками — ещё раз: вторая отмена, ждавшая замка, видит первую.
      const fresh = await db.directoryExchangeChange.findUnique({ where: { id: change.id }, select: { undoneAt: true } });
      if (!fresh || fresh.undoneAt) throw new DirectoryExchangeError(CHANGE_UNDONE_MESSAGE, 409, "change_undone");
      return op === "create" ? undoCreatedChange(change, input.actor.userId, now) : undoUpdatedChange(change, input.actor.userId, now);
    },
  );

  // В журнал организации; у участника другого аккаунта — без кабинета и источника владельца.
  const cabinet = await db.organization.findUnique({ where: { id: found.masterOrganizationId }, select: { accountId: true } });
  const sameAccount = cabinet?.accountId === accountId;
  try {
    await db.auditLog.create({
      data: {
        organizationId: found.organizationId,
        userId: input.actor.userId,
        userName: input.actor.userName,
        action: "directory_exchange.change_undone",
        entity: "directory_exchange_change",
        entityId: found.id,
        details: {
          changeId: found.id,
          changedAt: found.createdAt.toISOString(),
          entity,
          entityId: found.entityId,
          op,
          name: found.name,
          action: result.action,
          ...(sameAccount
            ? { masterOrganizationId: found.masterOrganizationId, sourceOrganizationId: found.sourceOrganizationId }
            : { crossAccount: true }),
        } satisfies Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    console.error("[directory-exchange] history undo audit failed", { organizationId: found.organizationId, error });
  }
  return result;
}
