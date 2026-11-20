import type { Prisma } from "@prisma/client";

import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_KINDS, emptyKindRecord, type ExchangeEntity, type ExchangeKind } from "@/lib/directory-exchange/kinds";
import { parseExchangeSummary, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import {
  canUndoTransfer,
  decideUndo,
  editedAfter,
  emptyTransferCreated,
  keepMirrorPartners,
  mirrorPairs,
  parseTransferCreated,
  parseUndoResult,
  transferCreatedCount,
  transferUndoDeadline,
  TRANSFER_UNDO_MS,
  TRANSFER_UNDONE_MESSAGE,
  type KeptItem,
  type TransferCreated,
  type TransferUndoResult,
  type UndoDecision,
  type UndoneItem,
} from "@/lib/directory-exchange/transfer-undo";
import { isFryerEquipmentType } from "@/lib/fryer-oil-equipment-link";
import { syncFryerOilDocumentsSafe } from "@/lib/fryer-oil-equipment-sync";
import { normalizePlaceName } from "@/lib/orphan-areas";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Отмена разового переноса (серия B, пункт 12): запись того, что перенос
 * создал (`startTransferRecord` — её ведёт `transferOnce`), список последних
 * переносов и сама отмена.
 *
 * Отменить может владелец аккаунта организации-получателя в течение 7 дней,
 * один раз. Решение по каждой записи — `decideUndo` (transfer-undo.ts) по
 * фактам из базы: правили ли после переноса (`updatedAt`, где он есть; у
 * сотрудника — вход, Telegram, роль руководителя), используется ли (записи
 * журналов и документов, датчики, смены работы, назначения), остались ли
 * вложенные записи. Порядок — потомки раньше родителей: оборудование,
 * сотрудники, продукты, помещения и цеха, должности, объекты.
 *
 * Отмена идёт под тем же замком, что и перенос в эту организацию, одной
 * транзакцией; повтор отсекается атомарным `undoneAt: null → now`.
 */

const TRANSFER_LOCK_PREFIX = "directory-transfer";
const NOT_FOUND_MESSAGE = "Перенос не найден";
const BUSY_MESSAGE = "Перенос или отмена уже выполняются. Подождите минуту и повторите.";
const RECENT_LIMIT = 20;

/* ───────────────────────── запись переноса ───────────────────────── */

export type TransferRecorder = {
  /** Перенос создал запись; помещение и цех запоминают и зеркало, которое завело их создание. */
  created(entity: ExchangeEntity, id: string): Promise<void>;
  /** Сохранить перенос (`DirectoryTransfer`); ничего не создано — строки нет. Не бросает. */
  save(input: {
    fromOrganizationId: string;
    toOrganizationId: string;
    actorUserId: string | null;
    requestId: string | null;
    summary: ExchangeSummary;
  }): Promise<string | null>;
};

/**
 * Начать запись переноса в организацию. Помещения и цеха, которые у неё уже
 * есть, запоминаются: зеркалом новой записи считается только то, что появилось
 * во время переноса. Сбой чтения не ломает перенос — зеркала тогда не пишутся.
 */
export async function startTransferRecord(organizationId: string): Promise<TransferRecorder> {
  const created = emptyTransferCreated();
  let before: { rooms: Set<string>; areas: Set<string> } | null = null;
  try {
    const [rooms, areas] = await Promise.all([
      db.room.findMany({ where: { building: { organizationId } }, select: { id: true } }),
      db.area.findMany({ where: { organizationId }, select: { id: true } }),
    ]);
    before = { rooms: new Set(rooms.map((row) => row.id)), areas: new Set(areas.map((row) => row.id)) };
  } catch (error) {
    console.error("[directory-exchange] transfer record: places not read", { organizationId, error });
  }
  const remember = (entity: ExchangeEntity, id: string) => {
    if (!created[entity].includes(id)) created[entity].push(id);
  };

  return {
    async created(entity, id) {
      remember(entity, id);
      if (!before || (entity !== "room" && entity !== "area")) return;
      try {
        const place =
          entity === "room"
            ? await db.room.findUnique({ where: { id }, select: { name: true, buildingId: true } })
            : await db.area.findUnique({ where: { id }, select: { name: true, buildingId: true } });
        if (!place?.buildingId) return;
        const key = normalizePlaceName(place.name);
        // Помещение завело цех-зеркало, цех — помещение-зеркало: то же название на том же объекте.
        const mirrors =
          entity === "room"
            ? await db.area.findMany({ where: { organizationId, buildingId: place.buildingId }, select: { id: true, name: true } })
            : await db.room.findMany({ where: { buildingId: place.buildingId }, select: { id: true, name: true } });
        const mirrorEntity: ExchangeEntity = entity === "room" ? "area" : "room";
        const existed = entity === "room" ? before.areas : before.rooms;
        for (const mirror of mirrors) {
          if (normalizePlaceName(mirror.name) !== key || existed.has(mirror.id)) continue;
          remember(mirrorEntity, mirror.id);
        }
      } catch (error) {
        console.error("[directory-exchange] transfer record: mirror not read", { organizationId, entity, error });
      }
    },
    async save(input) {
      if (transferCreatedCount(created) === 0) return null;
      try {
        const row = await db.directoryTransfer.create({
          data: {
            fromOrganizationId: input.fromOrganizationId,
            toOrganizationId: input.toOrganizationId,
            actorUserId: input.actorUserId,
            requestId: input.requestId,
            createdJson: created as unknown as Prisma.InputJsonObject,
            summaryJson: input.summary as unknown as Prisma.InputJsonObject,
          },
          select: { id: true },
        });
        return row.id;
      } catch (error) {
        console.error("[directory-exchange] transfer record not saved", { toOrganizationId: input.toOrganizationId, error });
        return null;
      }
    },
  };
}

/* ───────────────────────── список ───────────────────────── */

export type RecentTransfer = {
  id: string;
  createdAt: string;
  /** Откуда: своя организация — её название; другая компания — название её мастер-кабинета (или пусто). */
  from: { name: string; foreign: boolean };
  to: { id: string; name: string };
  /** Сколько записей создано по спискам (из итога переноса). */
  counts: Record<ExchangeKind, number>;
  /** До какого момента можно отменить. */
  undoUntil: string;
  /** Можно отменить сейчас: в срок и ещё не отменён. */
  undoable: boolean;
  undoneAt: string | null;
  undo: TransferUndoResult | null;
};

function createdCounts(summary: ExchangeSummary | null, organizationId: string): Record<ExchangeKind, number> {
  const counts = emptyKindRecord(() => 0);
  const own = summary?.organizations.find((organization) => organization.organizationId === organizationId);
  for (const kind of EXCHANGE_KINDS) counts[kind] = own?.kinds[kind].created ?? 0;
  return counts;
}

/**
 * Переносы последних 7 дней в организации аккаунта, владелец которого —
 * `userId`: новые первыми. Перенос от другой компании (по её подтверждённому
 * запросу) показывается названием её мастер-кабинета — организации другого
 * аккаунта получателю не называются.
 */
export async function listRecentTransfers(
  owner: { accountId: string; userId: string },
  options: { now?: Date; limit?: number } = {},
): Promise<RecentTransfer[]> {
  const now = options.now ?? new Date();
  const rows = await db.directoryTransfer.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - TRANSFER_UNDO_MS) },
      toOrganization: { accountId: owner.accountId, account: { ownerUserId: owner.userId } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(1, Math.min(options.limit ?? RECENT_LIMIT, 100)),
    select: {
      id: true,
      createdAt: true,
      requestId: true,
      summaryJson: true,
      undoneAt: true,
      undoJson: true,
      toOrganization: { select: { id: true, name: true, accountId: true } },
      fromOrganization: { select: { name: true, accountId: true } },
    },
  });
  const requestIds = [...new Set(rows.map((row) => row.requestId).filter((id): id is string => Boolean(id)))];
  const cabinets = requestIds.length
    ? new Map(
        (
          await db.directoryExchangeRequest.findMany({
            where: { id: { in: requestIds } },
            select: { id: true, masterOrganization: { select: { name: true } } },
          })
        ).map((request) => [request.id, request.masterOrganization.name]),
      )
    : new Map<string, string>();

  return rows.map((row) => {
    const foreign = row.fromOrganization.accountId !== row.toOrganization.accountId;
    const deadline = transferUndoDeadline(row.createdAt);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      from: {
        name: foreign ? (row.requestId ? cabinets.get(row.requestId) ?? "" : "") : row.fromOrganization.name,
        foreign,
      },
      to: { id: row.toOrganization.id, name: row.toOrganization.name },
      counts: createdCounts(parseExchangeSummary(row.summaryJson), row.toOrganization.id),
      undoUntil: deadline.toISOString(),
      undoable: canUndoTransfer({ createdAt: row.createdAt, undoneAt: row.undoneAt, now }).ok,
      undoneAt: row.undoneAt?.toISOString() ?? null,
      undo: parseUndoResult(row.undoJson),
    };
  });
}

/* ───────────────────────── отмена ───────────────────────── */

type Tx = Prisma.TransactionClient;

/**
 * Из этих id — те, что встречаются в записях документов журналов организации
 * (`JournalDocumentEntry.data`): документ хранит оборудование, цех или
 * помещение строкой внутри JSON, связи по ключу у него нет.
 */
async function idsInDocumentEntries(tx: Tx, organizationId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT candidate.id
    FROM unnest(${[...ids]}::text[]) AS candidate(id)
    WHERE EXISTS (
      SELECT 1
      FROM "JournalDocumentEntry" entry
      JOIN "JournalDocument" document ON document.id = entry."documentId"
      WHERE document."organizationId" = ${organizationId}
        AND strpos(entry.data::text, candidate.id) > 0
    )`;
  return new Set(rows.map((row) => row.id));
}

/** Сотрудники, назначенные где-то в настройках: уборка и проверка помещений, «кто заполняет», ответственные, видимость. */
async function assignedStaff(tx: Tx, organizationId: string, ids: readonly string[]): Promise<Set<string>> {
  const assigned = new Set<string>();
  if (ids.length === 0) return assigned;
  const list = [...ids];
  const [rooms, equipment, positions, scopes, organization, buildings] = await Promise.all([
    tx.room.findMany({
      where: {
        building: { organizationId },
        OR: [{ cleanerUserIds: { hasSome: list } }, { fillerUserIds: { hasSome: list } }, { verifierUserIds: { hasSome: list } }],
      },
      select: { cleanerUserIds: true, fillerUserIds: true, verifierUserIds: true },
    }),
    tx.equipment.findMany({
      where: { area: { organizationId }, fillerUserIds: { hasSome: list } },
      select: { fillerUserIds: true },
    }),
    tx.jobPosition.findMany({ where: { organizationId, visibleUserIds: { hasSome: list } }, select: { visibleUserIds: true } }),
    tx.managerScope.findMany({ where: { organizationId, viewUserIds: { hasSome: list } }, select: { viewUserIds: true } }),
    tx.organization.findUnique({ where: { id: organizationId }, select: { journalResponsibleUsersJson: true } }),
    tx.building.findMany({ where: { organizationId }, select: { journalResponsibleUsersJson: true } }),
  ]);
  const wanted = new Set(list);
  const take = (values: readonly string[]) => {
    for (const value of values) if (wanted.has(value)) assigned.add(value);
  };
  for (const room of rooms) take([...room.cleanerUserIds, ...room.fillerUserIds, ...room.verifierUserIds]);
  for (const row of equipment) take(row.fillerUserIds);
  for (const row of positions) take(row.visibleUserIds);
  for (const row of scopes) take(row.viewUserIds);
  // Ответственные за журналы организации и точек — JSON `{ код: { слот: userId } }`.
  const responsibles = [organization?.journalResponsibleUsersJson, ...buildings.map((row) => row.journalResponsibleUsersJson)]
    .map((value) => (value ? JSON.stringify(value) : ""))
    .join("\n");
  for (const id of list) if (responsibles.includes(id)) assigned.add(id);
  return assigned;
}

type UndoOutcome = { result: TransferUndoResult; fryersRemoved: boolean };

/** Итог отмены: решения по записям сущности ложатся в «отменено» и «осталось»; `settle` возвращает id к отмене. */
class UndoLedger {
  readonly undone: UndoneItem[] = [];
  readonly kept: KeptItem[] = [];

  settle(entity: ExchangeEntity, rows: ReadonlyArray<{ id: string; name: string }>, decisions: ReadonlyMap<string, UndoDecision>): string[] {
    const ids: string[] = [];
    for (const row of rows) {
      const decision = decisions.get(row.id);
      if (!decision || decision.kind === "skip") continue;
      if (decision.kind === "keep") this.kept.push({ entity, id: row.id, name: row.name, reason: decision.reason });
      else {
        this.undone.push({ entity, id: row.id, name: row.name, action: decision.action });
        ids.push(row.id);
      }
    }
    return ids;
  }
}

/**
 * Отменить созданное переносом в организации — в транзакции `tx`. Записи,
 * которых уже нет (удалили вручную), пропускаются молча.
 */
async function undoCreated(
  tx: Tx,
  params: { organizationId: string; created: TransferCreated; transferAt: Date; now: Date },
): Promise<UndoOutcome> {
  const { organizationId, created, transferAt, now } = params;
  const ledger = new UndoLedger();
  const inDocuments = await idsInDocumentEntries(tx, organizationId, [...created.equipment, ...created.area, ...created.room]);

  // 1. Оборудование: записи журналов и документов, датчики, смены работы УФ-ламп.
  const equipment = await tx.equipment.findMany({
    where: { id: { in: created.equipment }, area: { organizationId } },
    select: {
      id: true,
      name: true,
      type: true,
      tuyaDeviceId: true,
      fillerUserIds: true,
      lampInstalledAt: true,
      lampUsedHours: true,
      runningSince: true,
      _count: { select: { journalEntries: true, sensorMappings: true, runSessions: true } },
    },
  });
  const equipmentIds = ledger.settle(
    "equipment",
    equipment,
    new Map(
      equipment.map((row) => [
        row.id,
        decideUndo("equipment", {
          // Своего `updatedAt` у оборудования нет: правка видна по «кто заполняет».
          edited: row.fillerUserIds.length > 0,
          used:
            row._count.journalEntries + row._count.sensorMappings + row._count.runSessions > 0 ||
            Boolean(row.tuyaDeviceId) ||
            Boolean(row.runningSince) ||
            Boolean(row.lampInstalledAt) ||
            row.lampUsedHours > 0 ||
            inDocuments.has(row.id),
        }),
      ]),
    ),
  );
  if (equipmentIds.length > 0) await tx.equipment.deleteMany({ where: { id: { in: equipmentIds } } });
  const fryersRemoved = equipment.some((row) => equipmentIds.includes(row.id) && isFryerEquipmentType(row.type));

  // 2. Сотрудники: в архив, если по ним нет записей журналов и их нигде не назначили.
  const staff = await tx.user.findMany({
    where: { id: { in: created.staff }, organizationId },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
      archivedAt: true,
      passwordHash: true,
      telegramChatId: true,
      _count: { select: { journalEntries: true, documentEntries: true } },
    },
  });
  const assigned = await assignedStaff(
    tx,
    organizationId,
    staff.map((row) => row.id),
  );
  const staffIds = ledger.settle(
    "staff",
    staff,
    new Map(
      staff.map((row) => [
        row.id,
        decideUndo("staff", {
          inactive: !row.isActive || Boolean(row.archivedAt),
          // Дали вход, привязали Telegram, сделали руководителем.
          edited: row.passwordHash !== "" || Boolean(row.telegramChatId) || isManagementRole(row.role),
          used: row._count.journalEntries + row._count.documentEntries > 0 || assigned.has(row.id),
        }),
      ]),
    ),
  );
  if (staffIds.length > 0) {
    await tx.user.updateMany({ where: { id: { in: staffIds }, organizationId }, data: { isActive: false, archivedAt: now } });
  }

  // 3. Продукты: выключаются, если их не правили. Журналы хранят название, связи нет.
  const products = await tx.product.findMany({
    where: { id: { in: created.product }, organizationId },
    select: { id: true, name: true, isActive: true, updatedAt: true },
  });
  const productIds = ledger.settle(
    "product",
    products,
    new Map(
      products.map((row) => [
        row.id,
        decideUndo("product", { inactive: !row.isActive, edited: editedAfter(row.updatedAt, transferAt) }),
      ]),
    ),
  );
  if (productIds.length > 0) {
    await tx.product.updateMany({ where: { id: { in: productIds }, organizationId }, data: { isActive: false } });
  }

  // 4. Помещения и цеха — после оборудования: цех пуст, только если его оборудование ушло.
  const [rooms, areas] = await Promise.all([
    tx.room.findMany({
      where: { id: { in: created.room }, building: { organizationId } },
      select: { id: true, name: true, buildingId: true, updatedAt: true },
    }),
    tx.area.findMany({
      where: { id: { in: created.area }, organizationId },
      select: { id: true, name: true, buildingId: true, _count: { select: { equipment: true, journalEntries: true } } },
    }),
  ]);
  const places = keepMirrorPartners(
    new Map<string, UndoDecision>([
      ...rooms.map(
        (row): [string, UndoDecision] => [
          row.id,
          decideUndo("room", { edited: editedAfter(row.updatedAt, transferAt), used: inDocuments.has(row.id) }),
        ],
      ),
      ...areas.map(
        (row): [string, UndoDecision] => [
          row.id,
          decideUndo("area", {
            used: row._count.journalEntries > 0 || inDocuments.has(row.id),
            hasChildren: row._count.equipment > 0,
          }),
        ],
      ),
    ]),
    mirrorPairs(rooms, areas),
  );
  const roomIds = ledger.settle("room", rooms, places);
  const areaIds = ledger.settle("area", areas, places);
  if (roomIds.length > 0) await tx.room.deleteMany({ where: { id: { in: roomIds } } });
  if (areaIds.length > 0) await tx.area.deleteMany({ where: { id: { in: areaIds }, organizationId } });

  // 5. Должности — после сотрудников: без действующих сотрудников, смен и настроек доступа.
  const positions = await tx.jobPosition.findMany({
    where: { id: { in: created.position }, organizationId },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: {
        select: { users: { where: { isActive: true, archivedAt: null } }, workShifts: true, journalAccess: true },
      },
    },
  });
  const positionIds = ledger.settle(
    "position",
    positions,
    new Map(
      positions.map((row) => [
        row.id,
        decideUndo("position", {
          edited: editedAfter(row.updatedAt, transferAt),
          used: row._count.workShifts + row._count.journalAccess > 0,
          hasChildren: row._count.users > 0,
        }),
      ]),
    ),
  );
  if (positionIds.length > 0) await tx.jobPosition.deleteMany({ where: { id: { in: positionIds }, organizationId } });

  // 6. Объекты — последними: пустые, без документов, людей и всего, что к ним привязано.
  const buildings = await tx.building.findMany({
    where: { id: { in: created.building }, organizationId },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: {
        select: {
          rooms: true,
          areas: true,
          journalDocuments: true,
          journalObligations: true,
          paperJournalDocuments: true,
          mercuryEnterprises: true,
          supplyDocuments: true,
          lossRecords: true,
          labelPrints: true,
          pointAssignments: true,
          ppkRecords: true,
          ppkDocuments: true,
          inspectorTokens: true,
          printAgents: true,
          printJobs: true,
          batches: true,
          capaTickets: true,
        },
      },
    },
  });
  const buildingList = buildings.map((row) => row.id);
  const people = buildingList.length
    ? await tx.user.findMany({
        where: { organizationId, OR: [{ buildingIds: { hasSome: buildingList } }, { primaryBuildingId: { in: buildingList } }] },
        select: { buildingIds: true, primaryBuildingId: true },
      })
    : [];
  const peopled = new Set(people.flatMap((person) => [...person.buildingIds, person.primaryBuildingId ?? ""]));
  const buildingIds = ledger.settle(
    "building",
    buildings,
    new Map(
      buildings.map((row) => {
        const { rooms: roomCount, areas: areaCount, ...links } = row._count;
        return [
          row.id,
          decideUndo("building", {
            edited: editedAfter(row.updatedAt, transferAt),
            used: Object.values(links).some((count) => count > 0) || peopled.has(row.id),
            hasChildren: roomCount + areaCount > 0,
          }),
        ];
      }),
    ),
  );
  if (buildingIds.length > 0) await tx.building.deleteMany({ where: { id: { in: buildingIds }, organizationId } });

  return { result: { undone: ledger.undone, kept: ledger.kept }, fryersRemoved };
}

/**
 * Отменить перенос (Р12.2). Только владелец аккаунта организации-получателя:
 * чужое и несуществующее — одно и то же 404. Срок вышел или уже отменён — 409.
 * Возвращает, что отменено и что осталось и почему.
 */
export async function undoTransfer(input: {
  id: string;
  ownerUserId: string;
  ownerName?: string | null;
  now?: Date;
}): Promise<TransferUndoResult> {
  const now = input.now ?? new Date();
  const transfer = await db.directoryTransfer.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      createdAt: true,
      undoneAt: true,
      createdJson: true,
      requestId: true,
      toOrganizationId: true,
      toOrganization: { select: { accountId: true, account: { select: { ownerUserId: true } } } },
      fromOrganization: { select: { id: true, name: true, accountId: true } },
    },
  });
  if (!transfer || !transfer.toOrganization.accountId || transfer.toOrganization.account?.ownerUserId !== input.ownerUserId) {
    throw new DirectoryExchangeError(NOT_FOUND_MESSAGE, 404);
  }
  const allowed = canUndoTransfer({ createdAt: transfer.createdAt, undoneAt: transfer.undoneAt, now });
  if (!allowed.ok) throw new DirectoryExchangeError(allowed.message, allowed.status, `transfer_${allowed.reason}`);

  const organizationId = transfer.toOrganizationId;
  const created = parseTransferCreated(transfer.createdJson);
  const locked = await withAdvisoryTryLock(
    advisoryLockKey(TRANSFER_LOCK_PREFIX, organizationId),
    () =>
      db.$transaction(
        async (tx) => {
          // Отмена одна: вторая, пришедшая одновременно, здесь получает 0 строк.
          const claimed = await tx.directoryTransfer.updateMany({
            where: { id: transfer.id, undoneAt: null },
            data: { undoneAt: now, undoneByUserId: input.ownerUserId },
          });
          if (claimed.count === 0) throw new DirectoryExchangeError(TRANSFER_UNDONE_MESSAGE, 409, "transfer_undone");
          const outcome = await undoCreated(tx, { organizationId, created, transferAt: transfer.createdAt, now });
          await tx.directoryTransfer.update({
            where: { id: transfer.id },
            data: { undoJson: outcome.result as unknown as Prisma.InputJsonObject },
          });
          return outcome;
        },
        { maxWait: 10_000, timeout: 120_000 },
      ),
    { attempts: 16, delayMs: 250, timeoutMs: 180_000 },
  );
  if (!locked.acquired) throw new DirectoryExchangeError(BUSY_MESSAGE, 409, "transfer_busy");
  const { result, fryersRemoved } = locked.value;

  // Удалённая фритюрница — связь в журнале фритюра снимается (как при удалении оборудования).
  if (fryersRemoved) await syncFryerOilDocumentsSafe(organizationId);

  const sameAccount = transfer.fromOrganization.accountId === transfer.toOrganization.accountId;
  try {
    await db.auditLog.create({
      data: {
        organizationId,
        userId: input.ownerUserId,
        userName: input.ownerName ?? null,
        action: "directory_exchange.transfer_undone",
        entity: "directory_transfer",
        entityId: transfer.id,
        details: {
          transferId: transfer.id,
          transferredAt: transfer.createdAt.toISOString(),
          // Организация другого аккаунта получателю не называется.
          ...(sameAccount
            ? { fromOrganizationId: transfer.fromOrganization.id, fromOrganizationName: transfer.fromOrganization.name }
            : { crossAccount: true, ...(transfer.requestId ? { requestId: transfer.requestId } : {}) }),
          undone: result.undone.length,
          kept: result.kept.map((item) => ({ entity: item.entity, name: item.name, reason: item.reason })),
        } satisfies Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    console.error("[directory-exchange] transfer undo audit failed", { organizationId, error });
  }
  return result;
}
