import { canManageNetworkRole } from "@/lib/account-roles";
import { accountRoleForOrganization, canManageNetwork } from "@/lib/account-roles.server";
import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { db } from "@/lib/db";
import { countExchangeRecords } from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { emptyKindRecord, normalizeExchangeKinds, type ExchangeKind } from "@/lib/directory-exchange/kinds";
import { parseExchangeSummary, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { ensureServiceCode } from "@/lib/dish-pool";
import { generateServiceCode } from "@/lib/dish-pool-code";
import { createAccountMasterCabinet, MasterCabinetError } from "@/lib/master-cabinet";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { isOrganizationLocked } from "@/lib/org-trial.server";

/**
 * Настройка обмена справочниками (правила Р2 и Р7): кто участвует и какими
 * списками. Настраивает владелец аккаунта или управляющий сетью (серия E,
 * Р5) и только между организациями своего аккаунта; участники привязаны к
 * мастер-кабинету аккаунта — самому раннему, а если кабинета нет, он
 * создаётся с названием «Мастер-кабинет».
 */

export const EXCHANGE_CABINET_NAME = "Мастер-кабинет";
export const EXCHANGE_OWNER_ONLY_MESSAGE = "Настраивать обмен справочниками может владелец аккаунта или управляющий сетью";
/** Запросы и связи с другой компанией — только владелец аккаунта (не управляющий сетью). */
export const EXCHANGE_ACCOUNT_OWNER_ONLY_MESSAGE = "Это может только владелец аккаунта";
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
  /** Владелец аккаунта активной организации или управляющий сетью, с полным доступом, не «войти как». */
  canManage: boolean;
  /** Владелец аккаунта: запросы и связи с другой компанией — только ему. */
  isAccountOwner: boolean;
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
 * Заводит владелец аккаунта или управляющий сетью (`actorUserId`); кабинет
 * всегда принадлежит владельцу аккаунта. Два одновременных запроса второго
 * кабинета не заводят.
 */
export async function ensureExchangeCabinet(
  actorUserId: string,
  accountId: string,
): Promise<ExchangeCabinet & { created: boolean }> {
  const account = await db.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } });
  if (!account || !(await canManageNetwork(actorUserId, accountId))) {
    throw new DirectoryExchangeError(EXCHANGE_OWNER_ONLY_MESSAGE, 403);
  }
  const ownerUserId = account.ownerUserId;
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

/**
 * Код кабинета для запросов от других компаний (серия B, Р13.1) —
 * `exchangeCode`. Пока его нет, действует прежний код — `serviceCode`
 * кабинета (заводится, если нет и его): первый показ запоминает его в
 * `exchangeCode`, и код, уже переданный другой компании, продолжает работать.
 * Сам `serviceCode` — код меню и сырья, по нему подключены объекты — не
 * меняется никогда.
 */
export async function exchangeCabinetCode(cabinetId: string): Promise<string | null> {
  try {
    const cabinet = await db.organization.findUnique({ where: { id: cabinetId }, select: { exchangeCode: true } });
    if (!cabinet) return null;
    if (cabinet.exchangeCode) return cabinet.exchangeCode;
    const serviceCode = await ensureServiceCode(cabinetId);
    // Параллельный показ или «Выдать новый код» могли успеть раньше — их код не перезаписываем.
    await db.organization.updateMany({ where: { id: cabinetId, exchangeCode: null }, data: { exchangeCode: serviceCode } });
    const current = await db.organization.findUnique({ where: { id: cabinetId }, select: { exchangeCode: true } });
    return current?.exchangeCode ?? null;
  } catch (error) {
    console.error("[directory-exchange] cabinet code failed", { cabinetId, error });
    return null;
  }
}

/**
 * Принимает ли аккаунт прежние коды для запросов (Р13.1): код меню своего
 * кабинета и, у кабинетов постарше, код пула, к которому кабинет подключён.
 * Да — пока владелец не выдал новый код: `exchangeCode` кабинета обмена пуст
 * или совпадает с его `serviceCode` (так его запоминает первый показ).
 */
export async function acceptsLegacyExchangeCode(accountId: string): Promise<boolean> {
  const exchange = await findExchangeCabinet(accountId);
  if (!exchange) return false;
  const cabinet = await db.organization.findUnique({
    where: { id: exchange.id },
    select: { serviceCode: true, exchangeCode: true },
  });
  return !cabinet?.exchangeCode || cabinet.exchangeCode === cabinet.serviceCode;
}

/** Код не занят ни одной организацией (код меню, код обмена, подключение) и ни одной точкой. */
async function isExchangeCodeFree(code: string): Promise<boolean> {
  const [organization, building] = await Promise.all([
    db.organization.findFirst({
      where: { OR: [{ serviceCode: code }, { exchangeCode: code }, { linkedServiceCode: code }] },
      select: { id: true },
    }),
    db.building.findFirst({ where: { OR: [{ serviceCode: code }, { linkedServiceCode: code }] }, select: { id: true } }),
  ]);
  return !organization && !building;
}

/**
 * «Выдать новый код» (Р13.2): новый `exchangeCode` мастер-кабинета аккаунта.
 * Прежний код перестаёт приниматься для новых запросов — и прежний путь через
 * код меню тоже (`acceptsLegacyExchangeCode`); подтверждённые связи, ждущие
 * запросы и подключения к меню и сырью (`serviceCode`, `linkedServiceCode`)
 * не меняются. Владелец аккаунта или управляющий сетью (`ownerUserId` — кто
 * действует); в журнале — что код сменился и кем, без самих кодов.
 */
export async function regenerateExchangeCode(input: {
  ownerUserId: string;
  ownerName?: string | null;
  accountId: string;
  /** Активная организация владельца — в её журнал пишется действие. */
  organizationId: string;
}): Promise<{ cabinet: ExchangeCabinet; code: string }> {
  if (!(await canManageNetwork(input.ownerUserId, input.accountId))) {
    throw new DirectoryExchangeError(EXCHANGE_OWNER_ONLY_MESSAGE, 403);
  }
  const cabinet = await findExchangeCabinet(input.accountId);
  if (!cabinet) throw new DirectoryExchangeError("Мастер-кабинет не найден", 404);

  let code: string | null = null;
  for (let attempt = 0; attempt < 8 && !code; attempt += 1) {
    const candidate = generateServiceCode();
    if (!(await isExchangeCodeFree(candidate))) continue;
    try {
      await db.organization.update({ where: { id: cabinet.id }, data: { exchangeCode: candidate } });
      code = candidate;
    } catch (error) {
      // Тот же код только что занял другой кабинет (unique) — пробуем другой.
      if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    }
  }
  if (!code) throw new DirectoryExchangeError("Не удалось выдать новый код — попробуйте ещё раз", 409);

  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.ownerUserId,
        userName: input.ownerName ?? null,
        action: "directory_exchange.code_regenerated",
        entity: "organization",
        entityId: cabinet.id,
        details: { masterOrganizationId: cabinet.id, cabinetName: cabinet.name },
      },
    });
  } catch (error) {
    console.error("[directory-exchange] audit failed", { organizationId: input.organizationId, error });
  }
  return { cabinet, code };
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
    },
  });
  if (!organization) throw new DirectoryExchangeError(ORGANIZATION_NOT_FOUND, 404);

  const accountId = organization.accountId;
  // Владелец аккаунта или управляющий сетью (серия E, Р5) — роль по базе.
  const role =
    options.sessionAllows !== false && accountId && !organization.isDemo && organization.kind !== MASTER_ORG_KIND
      ? ((await accountRoleForOrganization(userId, organization.id))?.role ?? null)
      : null;
  const canManage = canManageNetworkRole(role);
  const base = { canManage, isAccountOwner: role === "owner", organization: { id: organization.id, name: organization.name } };
  if (!canManage || !accountId) {
    return { ...base, canManage: false, isAccountOwner: false, locked: false, counts: zeroCounts(), siblings: [], cabinet: null, cabinetCode: null, members: [], lastSync: null };
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
    // Сюда доходят только владелец аккаунта и управляющий сетью (выше — ранний выход для остальных).
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
 * владельца или управляющего сетью (по ней определяется аккаунт;
 * `ownerUserId` — кто действует, его имя — в журнале); `members` — только те
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
    select: { id: true, accountId: true, isDemo: true, kind: true },
  });
  if (!active) throw new DirectoryExchangeError(ORGANIZATION_NOT_FOUND, 404);
  const accountId = active.accountId;
  if (!accountId || active.isDemo || active.kind === MASTER_ORG_KIND || !(await canManageNetwork(input.ownerUserId, accountId))) {
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
        db.directoryExchangeSkip.deleteMany({ where: { masterOrganizationId: cabinet.id, organizationId } }),
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
