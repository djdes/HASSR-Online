import type { Prisma } from "@prisma/client";

import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { db } from "@/lib/db";
import { loadEntityRows, type ParentGroupLookup } from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import {
  EXCHANGE_ENTITIES,
  EXCHANGE_KINDS,
  emptyKindRecord,
  type ExchangeEntity,
  type ExchangeKind,
} from "@/lib/directory-exchange/kinds";
import { findExchangeCabinet } from "@/lib/directory-exchange/settings.server";
import { parseExchangeSummary, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import {
  canUndoTransfer,
  decideUndo,
  editedAfter,
  editedByHash,
  emptyTransferCreated,
  emptyTransferHashes,
  keepMirrorPartners,
  mirrorPairs,
  parseTransferCreated,
  parseTransferHashes,
  parseUndoResult,
  transferCreatedCount,
  transferCreatedJson,
  transferUndoDeadline,
  TRANSFER_UNDO_MS,
  TRANSFER_UNDONE_MESSAGE,
  type KeptItem,
  type TransferCreated,
  type TransferHashes,
  type TransferUndoResult,
  type UndoDecision,
  type UndoneItem,
} from "@/lib/directory-exchange/transfer-undo";
import { FRYER_OIL_TEMPLATE_CODE } from "@/lib/fryer-oil-document";
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
 * фактам из базы: правили ли после переноса (отпечаток записи с переноса
 * другой, `updatedAt` позже переноса; у сотрудника — ещё вход, Telegram, роль
 * руководителя), используется ли (записи журналов и документов, настройки
 * документов, чек-листы, киоски, отклонения температуры, датчики, смены
 * работы, назначения), остались ли вложенные записи. Порядок — потомки
 * раньше родителей: оборудование, сотрудники, продукты, помещения и цеха,
 * должности, объекты.
 *
 * Отмена идёт под замками обмена кабинетов, в которых участвует организация
 * (снаружи, по id), и под тем же замком, что и перенос в эту организацию
 * (внутри), одной транзакцией; повтор отсекается атомарным `undoneAt: null → now`.
 */

const TRANSFER_LOCK_PREFIX = "directory-transfer";
/** Замок обмена кабинета — тот же ключ, что у `runDirectoryExchange` и `withExchangeLock` (run.server.ts). */
const EXCHANGE_LOCK_PREFIX = "directory-exchange";
const EXCHANGE_BUSY_CODE = "exchange_busy";
const NOT_FOUND_MESSAGE = "Перенос не найден";
const BUSY_MESSAGE = "Перенос или отмена уже выполняются. Подождите минуту и повторите.";
const EXCHANGE_BUSY_MESSAGE = "Идёт обмен справочниками. Подождите минуту и повторите отмену.";
/** Сколько ждать замка и сколько может идти работа под ним. */
const LOCK_WAIT = { attempts: 16, delayMs: 250, timeoutMs: 180_000 } as const;

/**
 * Родитель строки — он сам: отпечаток не зависит от групп обмена и одинаков
 * при переносе и при отмене. Оборудование в другом цехе — тоже правка.
 */
const OWN_PARENT: ParentGroupLookup = (parentId) => parentId;

/** Отпечатки записей `ids` организации — как их видит обмен. Запись вне строк обмена — без отпечатка. */
async function currentHashes(organizationId: string, ids: TransferCreated): Promise<TransferHashes> {
  const hashes = emptyTransferHashes();
  for (const entity of EXCHANGE_ENTITIES) {
    if (ids[entity].length === 0) continue;
    const wanted = new Set(ids[entity]);
    for (const row of await loadEntityRows(entity, organizationId, OWN_PARENT)) {
      if (wanted.has(row.id)) hashes[entity][row.id] = row.hash;
    }
  }
  return hashes;
}
const RECENT_LIMIT = 20;

/* ───────────────────────── запись переноса ───────────────────────── */

export type TransferRecorder = {
  /** Перенос создал запись; помещение и цех запоминают и зеркало, которое завело их создание. */
  created(entity: ExchangeEntity, id: string): Promise<void>;
  /**
   * Снять отпечатки созданного — в конце переноса, ещё под его замком. Сбой
   * чтения не ломает перенос: отпечатков тогда нет, отмена решает по прежним признакам.
   */
  fingerprint(): Promise<void>;
  /** Сохранить перенос (`DirectoryTransfer`); ничего не создано — строки нет. Не бросает. */
  save(input: {
    fromOrganizationId: string;
    /** Название источника — только внутри аккаунта; другой компании — null. */
    fromOrganizationName: string | null;
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
  let hashes = emptyTransferHashes();
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
    async fingerprint() {
      try {
        hashes = await currentHashes(organizationId, created);
      } catch (error) {
        hashes = emptyTransferHashes();
        console.error("[directory-exchange] transfer record: fingerprints not read", { organizationId, error });
      }
    },
    async save(input) {
      if (transferCreatedCount(created) === 0) return null;
      try {
        const row = await db.directoryTransfer.create({
          data: {
            fromOrganizationId: input.fromOrganizationId,
            fromOrganizationName: input.fromOrganizationName,
            toOrganizationId: input.toOrganizationId,
            actorUserId: input.actorUserId,
            requestId: input.requestId,
            createdJson: transferCreatedJson(created, hashes) as unknown as Prisma.InputJsonObject,
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
 * Перенос от другой компании. Источник удалён — перенос между аккаунтами
 * всегда идёт по подтверждённому запросу (`requestId`), свой — без него.
 */
function isForeignTransfer(source: { accountId: string | null } | null, toAccountId: string | null, requestId: string | null): boolean {
  return source ? source.accountId !== toAccountId : Boolean(requestId);
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
      fromOrganizationName: true,
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
    const source = row.fromOrganization;
    const foreign = isForeignTransfer(source, row.toOrganization.accountId, row.requestId);
    const deadline = transferUndoDeadline(row.createdAt);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      from: {
        name: foreign
          ? (row.requestId ? cabinets.get(row.requestId) ?? "" : "")
          : (source?.name ?? row.fromOrganizationName ?? ""),
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
 * Из этих id — те, что встречаются в журналах организации строкой внутри
 * JSON (связи по ключу там нет): записи документов (`JournalDocumentEntry.data`),
 * настройки документов (`JournalDocument.config`: строки холодильников,
 * помещения уборки…) и старые записи журналов (`JournalEntry.data`). Каждая
 * таблица читается один раз, текст строки сверяется со всеми id сразу.
 *
 * Настройки журнала фритюра не в счёт: фритюрница попадает туда сама при
 * создании, и отмена снимает эту связь (`syncFryerOilDocumentsSafe`); её
 * настоящее использование — записи документа.
 */
async function idsInJournalTexts(tx: Tx, organizationId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  // OFFSET 0 — граница для планировщика: текст строки собирается один раз, а не на каждый id.
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT candidate.id
    FROM (
      SELECT texts.body
      FROM (
        SELECT entry.data::text AS body
        FROM "JournalDocumentEntry" entry
        JOIN "JournalDocument" document ON document.id = entry."documentId"
        WHERE document."organizationId" = ${organizationId}
        UNION ALL
        SELECT document.config::text AS body
        FROM "JournalDocument" document
        JOIN "JournalTemplate" template ON template.id = document."templateId"
        WHERE document."organizationId" = ${organizationId}
          AND document.config IS NOT NULL
          AND template.code <> ${FRYER_OIL_TEMPLATE_CODE}
        UNION ALL
        SELECT entry.data::text AS body
        FROM "JournalEntry" entry
        WHERE entry."organizationId" = ${organizationId}
      ) texts
      OFFSET 0
    ) source
    JOIN unnest(${[...ids]}::text[]) AS candidate(id) ON strpos(source.body, candidate.id) > 0`;
  return new Set(rows.map((row) => row.id));
}

/**
 * Созданное переносом, на что ссылаются журналы и настройки организации:
 * тексты журналов (`idsInJournalTexts`), чек-листы помещений, киоски объектов,
 * отклонения температуры оборудования. id — cuid, общий набор не путает сущности.
 */
async function referencedIds(tx: Tx, organizationId: string, created: TransferCreated): Promise<Set<string>> {
  const [texts, checklist, kiosks, incidents] = await Promise.all([
    idsInJournalTexts(tx, organizationId, [...created.equipment, ...created.area, ...created.room]),
    created.room.length
      ? tx.journalChecklistItem.findMany({ where: { organizationId, roomId: { in: created.room } }, select: { roomId: true } })
      : [],
    created.building.length
      ? tx.kioskDevice.findMany({ where: { organizationId, buildingId: { in: created.building } }, select: { buildingId: true } })
      : [],
    created.equipment.length
      ? tx.temperatureDeviationIncident.findMany({
          where: { organizationId, equipmentId: { in: created.equipment } },
          select: { equipmentId: true },
        })
      : [],
  ]);
  const referenced = new Set(texts);
  for (const row of checklist) if (row.roomId) referenced.add(row.roomId);
  for (const row of kiosks) if (row.buildingId) referenced.add(row.buildingId);
  for (const row of incidents) if (row.equipmentId) referenced.add(row.equipmentId);
  return referenced;
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
  params: {
    organizationId: string;
    created: TransferCreated;
    transferAt: Date;
    now: Date;
    /** Отпечатки с переноса и сейчас — правка у записей без `updatedAt`. */
    hashes: { stored: TransferHashes; current: TransferHashes };
  },
): Promise<UndoOutcome> {
  const { organizationId, created, transferAt, now, hashes } = params;
  const ledger = new UndoLedger();
  const referenced = await referencedIds(tx, organizationId, created);
  const changed = (entity: ExchangeEntity, id: string) => editedByHash(hashes.stored, hashes.current, entity, id);

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
          // Своего `updatedAt` у оборудования нет: правка видна по отпечатку и «кто заполняет».
          edited: row.fillerUserIds.length > 0 || changed("equipment", row.id),
          used:
            row._count.journalEntries + row._count.sensorMappings + row._count.runSessions > 0 ||
            Boolean(row.tuyaDeviceId) ||
            Boolean(row.runningSince) ||
            Boolean(row.lampInstalledAt) ||
            row.lampUsedHours > 0 ||
            referenced.has(row.id),
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
          // Дали вход, привязали Telegram, сделали руководителем, поправили ФИО, телефон, выходные, должность.
          edited:
            row.passwordHash !== "" ||
            Boolean(row.telegramChatId) ||
            isManagementRole(row.role) ||
            changed("staff", row.id),
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
        decideUndo("product", {
          inactive: !row.isActive,
          edited: editedAfter(row.updatedAt, transferAt) || changed("product", row.id),
        }),
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
          decideUndo("room", {
            edited: editedAfter(row.updatedAt, transferAt) || changed("room", row.id),
            used: referenced.has(row.id),
          }),
        ],
      ),
      ...areas.map(
        (row): [string, UndoDecision] => [
          row.id,
          decideUndo("area", {
            // Своего `updatedAt` у цеха нет: правка видна по отпечатку (название, описание).
            edited: changed("area", row.id),
            used: row._count.journalEntries > 0 || referenced.has(row.id),
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
          edited: editedAfter(row.updatedAt, transferAt) || changed("position", row.id),
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
            edited: editedAfter(row.updatedAt, transferAt) || changed("building", row.id),
            used: Object.values(links).some((count) => count > 0) || peopled.has(row.id) || referenced.has(row.id),
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
 * Кабинеты, обмен которых пишет в организацию: кабинет её аккаунта и
 * кабинеты, где она участник (в том числе другой компании). По id — замки
 * берутся всегда в одном порядке.
 */
async function exchangeCabinetsOf(organizationId: string, accountId: string): Promise<string[]> {
  const [own, memberships] = await Promise.all([
    findExchangeCabinet(accountId),
    db.directoryExchangeMember.findMany({ where: { organizationId }, select: { masterOrganizationId: true } }),
  ]);
  const ids = new Set(memberships.map((row) => row.masterOrganizationId));
  if (own) ids.add(own.id);
  return [...ids].sort();
}

/**
 * `fn` под замками обмена этих кабинетов (по одному, по порядку): идущий
 * обмен не заведёт оборудование в цех, который отмена удаляет. Обмен берёт
 * только свой замок, перенос — только замок переноса; отмена берёт замки
 * обмена снаружи, замок переноса — внутри, и круга ожидания нет.
 */
async function underExchangeLocks<T>(cabinetIds: readonly string[], fn: () => Promise<T>): Promise<T> {
  const [first, ...rest] = cabinetIds;
  if (!first) return fn();
  const locked = await withAdvisoryTryLock(advisoryLockKey(EXCHANGE_LOCK_PREFIX, first), () => underExchangeLocks(rest, fn), LOCK_WAIT);
  if (!locked.acquired) throw new DirectoryExchangeError(EXCHANGE_BUSY_MESSAGE, 409, EXCHANGE_BUSY_CODE);
  return locked.value;
}

/**
 * Отменить перенос (Р12.2). Только владелец аккаунта организации-получателя:
 * чужое и несуществующее — одно и то же 404. Срок вышел или уже отменён — 409;
 * идёт обмен кабинета организации или другой перенос в неё — 409, ничего не сделано.
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
      fromOrganizationId: true,
      fromOrganizationName: true,
      fromOrganization: { select: { name: true, accountId: true } },
    },
  });
  const accountId = transfer?.toOrganization.accountId;
  if (!transfer || !accountId || transfer.toOrganization.account?.ownerUserId !== input.ownerUserId) {
    throw new DirectoryExchangeError(NOT_FOUND_MESSAGE, 404);
  }
  const allowed = canUndoTransfer({ createdAt: transfer.createdAt, undoneAt: transfer.undoneAt, now });
  if (!allowed.ok) throw new DirectoryExchangeError(allowed.message, allowed.status, `transfer_${allowed.reason}`);

  const organizationId = transfer.toOrganizationId;
  const created = parseTransferCreated(transfer.createdJson);
  const stored = parseTransferHashes(transfer.createdJson);
  // Отпечатки сейчас — только у записей, для которых они сняты при переносе.
  const hashed = emptyTransferCreated();
  for (const entity of EXCHANGE_ENTITIES) hashed[entity] = created[entity].filter((id) => Object.hasOwn(stored[entity], id));

  const cabinetIds = await exchangeCabinetsOf(organizationId, accountId);
  const { result, fryersRemoved } = await underExchangeLocks(cabinetIds, async () => {
    const locked = await withAdvisoryTryLock(
      advisoryLockKey(TRANSFER_LOCK_PREFIX, organizationId),
      async () => {
        // Под замками: обмен и перенос записи организации сейчас не меняют.
        const current = await currentHashes(organizationId, hashed);
        return db.$transaction(
          async (tx) => {
            // Отмена одна: вторая, пришедшая одновременно, здесь получает 0 строк.
            const claimed = await tx.directoryTransfer.updateMany({
              where: { id: transfer.id, undoneAt: null },
              data: { undoneAt: now, undoneByUserId: input.ownerUserId },
            });
            if (claimed.count === 0) throw new DirectoryExchangeError(TRANSFER_UNDONE_MESSAGE, 409, "transfer_undone");
            const outcome = await undoCreated(tx, {
              organizationId,
              created,
              transferAt: transfer.createdAt,
              now,
              hashes: { stored, current },
            });
            await tx.directoryTransfer.update({
              where: { id: transfer.id },
              data: { undoJson: outcome.result as unknown as Prisma.InputJsonObject },
            });
            return outcome;
          },
          { maxWait: 10_000, timeout: 120_000 },
        );
      },
      LOCK_WAIT,
    );
    if (!locked.acquired) throw new DirectoryExchangeError(BUSY_MESSAGE, 409, "transfer_busy");
    return locked.value;
  });

  // Удалённая фритюрница — связь в журнале фритюра снимается (как при удалении оборудования).
  if (fryersRemoved) await syncFryerOilDocumentsSafe(organizationId);

  const sameAccount = !isForeignTransfer(transfer.fromOrganization, accountId, transfer.requestId);
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
            ? {
                fromOrganizationId: transfer.fromOrganizationId,
                fromOrganizationName: transfer.fromOrganization?.name ?? transfer.fromOrganizationName,
              }
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
