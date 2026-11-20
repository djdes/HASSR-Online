import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { db } from "@/lib/db";
import { countExchangeRecords } from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { emptyKindRecord, normalizeExchangeKinds, type ExchangeKind } from "@/lib/directory-exchange/kinds";
import { parseExchangeSummary, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { ensureServiceCode } from "@/lib/dish-pool";
import { createAccountMasterCabinet, MasterCabinetError } from "@/lib/master-cabinet";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { isOrganizationLocked } from "@/lib/org-trial.server";

/**
 * Настройка обмена справочниками (правила Р2 и Р7): кто участвует и какими
 * списками. Настраивает владелец аккаунта и только между организациями
 * своего аккаунта; участники привязаны к мастер-кабинету аккаунта — самому
 * раннему, а если кабинета нет, он создаётся с названием «Мастер-кабинет».
 */

export const EXCHANGE_CABINET_NAME = "Мастер-кабинет";
export const EXCHANGE_OWNER_ONLY_MESSAGE = "Настраивать обмен справочниками может только владелец аккаунта";
const ORGANIZATION_NOT_FOUND = "Организация не найдена";

export type ExchangeCabinet = { id: string; name: string };

export type ExchangeMemberState = {
  organizationId: string;
  name: string;
  kinds: ExchangeKind[];
  lastSyncedAt: string | null;
};

export type ExchangeSibling = {
  id: string;
  name: string;
  /** Сколько записей в каждом списке: продукты, сотрудники без входа, объекты без офиса, оборудование. */
  counts: Record<ExchangeKind, number>;
  /** Организация закрыта после своих 14 дней: в обмене и переносе не участвует. */
  locked: boolean;
};

export type ExchangeState = {
  /** Владелец аккаунта активной организации с полным доступом, не «войти как». */
  canManage: boolean;
  organization: { id: string; name: string };
  /** Активная организация закрыта после своих 14 дней. */
  locked: boolean;
  counts: Record<ExchangeKind, number>;
  /** Остальные рабочие организации аккаунта. */
  siblings: ExchangeSibling[];
  cabinet: ExchangeCabinet | null;
  /**
   * Код мастер-кабинета — его владелец передаёт другой компании, чтобы та
   * прислала запрос на обмен (часть 3). Только владельцу аккаунта; null —
   * кабинета ещё нет (`POST /api/settings/directory-exchange/cabinet` заведёт).
   */
  cabinetCode: string | null;
  members: ExchangeMemberState[];
  lastSync: ExchangeSummary | null;
};

const zeroCounts = () => emptyKindRecord(() => 0);

/** Мастер-кабинет обмена — самый ранний кабинет аккаунта. */
export async function findExchangeCabinet(accountId: string): Promise<ExchangeCabinet | null> {
  return db.organization.findFirst({
    where: { accountId, kind: MASTER_ORG_KIND },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * Кабинет обмена аккаунта: существующий или новый «Мастер-кабинет».
 * Создаёт только владелец аккаунта; два одновременных запроса второго
 * кабинета не заводят.
 */
export async function ensureExchangeCabinet(
  ownerUserId: string,
  accountId: string,
): Promise<ExchangeCabinet & { created: boolean }> {
  const account = await db.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } });
  if (!account || account.ownerUserId !== ownerUserId) {
    throw new DirectoryExchangeError(EXCHANGE_OWNER_ONLY_MESSAGE, 403);
  }
  const existing = await findExchangeCabinet(accountId);
  if (existing) return { ...existing, created: false };

  const locked = await withAdvisoryTryLock(
    advisoryLockKey("directory-exchange-cabinet", accountId),
    async () => {
      const again = await findExchangeCabinet(accountId);
      if (again) return { ...again, created: false };
      try {
        const created = await createAccountMasterCabinet({ ownerUserId, name: EXCHANGE_CABINET_NAME, organizationIds: [] });
        return { id: created.id, name: created.name, created: true };
      } catch (error) {
        if (error instanceof MasterCabinetError) throw new DirectoryExchangeError(error.message, error.status);
        throw error;
      }
    },
    { attempts: 20, delayMs: 150, timeoutMs: 30_000 },
  );
  if (!locked.acquired) {
    throw new DirectoryExchangeError("Не удалось создать мастер-кабинет — попробуйте ещё раз", 409);
  }
  return locked.value;
}

/** Код кабинета для запросов от других компаний; заводится, если его ещё нет. */
export async function exchangeCabinetCode(cabinetId: string): Promise<string | null> {
  return ensureServiceCode(cabinetId).catch((error) => {
    console.error("[directory-exchange] cabinet code failed", { cabinetId, error });
    return null;
  });
}

/** Рабочие организации аккаунта: без демо и без самих кабинетов. */
async function accountOrganizations(accountId: string) {
  return db.organization.findMany({
    where: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * Состояние обмена для окна и карточки «Обмен справочниками». Не владельцу
 * отдаётся только `canManage: false` — соседние организации и участников он
 * не видит. `sessionAllows: false` — «войти как» или нет полного доступа.
 */
export async function loadExchangeState(
  userId: string,
  organizationId: string,
  options: { sessionAllows?: boolean } = {},
): Promise<ExchangeState> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      accountId: true,
      isDemo: true,
      kind: true,
      account: { select: { ownerUserId: true } },
    },
  });
  if (!organization) throw new DirectoryExchangeError(ORGANIZATION_NOT_FOUND, 404);

  const accountId = organization.accountId;
  const canManage =
    options.sessionAllows !== false &&
    Boolean(accountId) &&
    organization.account?.ownerUserId === userId &&
    !organization.isDemo &&
    organization.kind !== MASTER_ORG_KIND;
  const base = { canManage, organization: { id: organization.id, name: organization.name } };
  if (!canManage || !accountId) {
    return { ...base, canManage: false, locked: false, counts: zeroCounts(), siblings: [], cabinet: null, cabinetCode: null, members: [], lastSync: null };
  }

  const [counts, locked, organizations, cabinet] = await Promise.all([
    countExchangeRecords(organization.id),
    isOrganizationLocked(organization.id),
    accountOrganizations(accountId),
    findExchangeCabinet(accountId),
  ]);
  const siblings = await Promise.all(
    organizations
      .filter((item) => item.id !== organization.id)
      .map(async (item) => ({
        id: item.id,
        name: item.name,
        counts: await countExchangeRecords(item.id),
        locked: await isOrganizationLocked(item.id),
      })),
  );

  const rows = cabinet
    ? await db.directoryExchangeMember.findMany({
        // Только организации этого же аккаунта: ушедшую из аккаунта не показываем.
        where: { masterOrganizationId: cabinet.id, organization: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          organizationId: true,
          kinds: true,
          lastSyncedAt: true,
          lastSyncJson: true,
          organization: { select: { name: true } },
        },
      })
    : [];
  const latest = rows.reduce<(typeof rows)[number] | null>(
    (best, row) =>
      row.lastSyncedAt && (!best?.lastSyncedAt || row.lastSyncedAt.getTime() > best.lastSyncedAt.getTime()) ? row : best,
    null,
  );

  return {
    ...base,
    locked,
    counts,
    siblings,
    cabinet,
    // Сюда доходит только владелец аккаунта (выше — ранний выход для остальных).
    cabinetCode: cabinet ? await exchangeCabinetCode(cabinet.id) : null,
    members: rows.map((row) => ({
      organizationId: row.organizationId,
      name: row.organization.name,
      kinds: normalizeExchangeKinds(row.kinds),
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    })),
    lastSync: latest ? parseExchangeSummary(latest.lastSyncJson) : null,
  };
}

/**
 * Сохранить участников обмена. `organizationId` — активная организация
 * владельца (по ней определяется аккаунт); `members` — только те
 * организации, которые меняются: непустые `kinds` — участвует этими
 * списками, пустые — выходит из обмена (её соответствия удаляются).
 * Остальные участники не затрагиваются. Кабинет создаётся, когда нужен.
 * К меню и сырью мастер-кабинета организация этим не подключается: это
 * отдельное явное действие в разделе «Мастер-кабинет».
 */
export async function saveExchangeMembers(input: {
  ownerUserId: string;
  ownerName?: string | null;
  organizationId: string;
  members: ReadonlyArray<{ organizationId: string; kinds: readonly string[] }>;
}): Promise<{ cabinet: ExchangeCabinet | null }> {
  const active = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, accountId: true, isDemo: true, kind: true, account: { select: { ownerUserId: true } } },
  });
  if (!active) throw new DirectoryExchangeError(ORGANIZATION_NOT_FOUND, 404);
  const accountId = active.accountId;
  if (!accountId || active.account?.ownerUserId !== input.ownerUserId || active.isDemo || active.kind === MASTER_ORG_KIND) {
    throw new DirectoryExchangeError(EXCHANGE_OWNER_ONLY_MESSAGE, 403);
  }

  // Одна организация — одна строка (последняя побеждает); только свои.
  const wanted = new Map<string, ExchangeKind[]>();
  for (const member of input.members) wanted.set(member.organizationId, normalizeExchangeKinds(member.kinds));
  const own = new Map((await accountOrganizations(accountId)).map((organization) => [organization.id, organization]));
  for (const organizationId of wanted.keys()) {
    if (!own.has(organizationId)) throw new DirectoryExchangeError(ORGANIZATION_NOT_FOUND, 404);
  }

  const joins = [...wanted.values()].some((kinds) => kinds.length > 0);
  const cabinet: ExchangeCabinet | null = joins
    ? await ensureExchangeCabinet(input.ownerUserId, accountId).then(({ id, name }) => ({ id, name }))
    : await findExchangeCabinet(accountId);
  if (!cabinet) return { cabinet: null };

  for (const [organizationId, kinds] of wanted) {
    if (kinds.length === 0) {
      await db.$transaction([
        db.directoryExchangeMember.deleteMany({ where: { masterOrganizationId: cabinet.id, organizationId } }),
        db.directoryExchangeLink.deleteMany({ where: { masterOrganizationId: cabinet.id, organizationId } }),
      ]);
      continue;
    }
    await db.directoryExchangeMember.upsert({
      where: { masterOrganizationId_organizationId: { masterOrganizationId: cabinet.id, organizationId } },
      create: { masterOrganizationId: cabinet.id, organizationId, kinds, createdByUserId: input.ownerUserId },
      update: { kinds },
    });
  }

  try {
    await db.auditLog.create({
      data: {
        organizationId: active.id,
        userId: input.ownerUserId,
        userName: input.ownerName ?? null,
        action: "directory_exchange.configured",
        entity: "organization",
        entityId: cabinet.id,
        details: {
          masterOrganizationId: cabinet.id,
          members: [...wanted].map(([organizationId, kinds]) => ({
            organizationId,
            name: own.get(organizationId)?.name ?? "",
            kinds,
          })),
        },
      },
    });
  } catch (error) {
    console.error("[directory-exchange] audit failed", { organizationId: active.id, error });
  }
  return { cabinet };
}
