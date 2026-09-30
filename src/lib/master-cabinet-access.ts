import { db } from "@/lib/db";
import {
  isRecommendedForCabinet,
  normalizeCabinetInvite,
  type AccessCandidate,
  type AccessOrganization,
  type AccessPerson,
  type CabinetAccess,
} from "@/lib/master-cabinet-access-view";
import { poolCodeOf } from "@/lib/master-cabinet-choice";
import { MasterCabinetError } from "@/lib/master-cabinet-error";
import {
  inviteMasterCabinetEmployee,
  MASTER_CABINET_POSITION_NAME,
  type MasterCabinetInvite,
} from "@/lib/master-cabinet-staff";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { bumpSessionVersion } from "@/lib/session-version";
import { getUserDisplayTitle } from "@/lib/user-roles";

/**
 * Доступ к мастер-кабинетам аккаунта (владелец, 2026-09-30) — «Настройки →
 * Права доступа → Мастер-кабинеты» и кнопка «Доступ» в самом кабинете.
 * Управляет владелец аккаунта:
 *   - пригласить по почте — человек становится сотрудником выбранной
 *     организации в группе «Мастер-кабинет» с доступом к кабинету;
 *   - дать доступ сотруднику объекта — участие в кабинете
 *     (`OrganizationMember`), кабинет появляется у него в меню профиля;
 *   - убрать доступ — участие снимается; кто был только для кабинета
 *     (группа «Мастер-кабинет», прежний аккаунт «только в кабинете») —
 *     в архив. Сессии человека завершаются.
 */

export type AccountCabinetsAccess = {
  cabinets: CabinetAccess[];
  candidates: AccessCandidate[];
  organizations: AccessOrganization[];
};

async function ownerAccountId(ownerUserId: string): Promise<string> {
  const account = await db.account.findUnique({ where: { ownerUserId }, select: { id: true } });
  if (!account) throw new MasterCabinetError("Доступом к мастер-кабинетам управляет владелец аккаунта", 403);
  return account.id;
}

async function ownedCabinet(accountId: string, cabinetId: unknown): Promise<{ id: string; name: string }> {
  const cabinet =
    typeof cabinetId === "string" && cabinetId
      ? await db.organization.findFirst({
          where: { id: cabinetId, accountId, kind: MASTER_ORG_KIND },
          select: { id: true, name: true },
        })
      : null;
  if (!cabinet) throw new MasterCabinetError("Мастер-кабинет не найден", 404);
  return cabinet;
}

/** Кабинеты аккаунта с людьми, кого можно добавить, и организации для приглашения. */
export async function listAccountCabinetsAccess(ownerUserId: string): Promise<AccountCabinetsAccess> {
  const accountId = await ownerAccountId(ownerUserId);
  const [cabinets, objects] = await Promise.all([
    db.organization.findMany({
      where: { accountId, kind: MASTER_ORG_KIND },
      select: { id: true, name: true, serviceCode: true, linkedServiceCode: true },
      orderBy: { name: "asc" },
    }),
    db.organization.findMany({
      where: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
      select: { id: true, name: true, serviceCode: true, linkedServiceCode: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const objectName = new Map(objects.map((object) => [object.id, object.name]));
  const cabinetIds = cabinets.map((cabinet) => cabinet.id);

  const [legacy, members, staff] = await Promise.all([
    cabinetIds.length
      ? db.user.findMany({
          where: { organizationId: { in: cabinetIds }, isRoot: false, archivedAt: null },
          select: { id: true, name: true, email: true, isActive: true, organizationId: true },
          orderBy: { createdAt: "asc" },
        })
      : [],
    cabinetIds.length
      ? db.organizationMember.findMany({
          where: { organizationId: { in: cabinetIds }, userId: { not: ownerUserId } },
          select: {
            organizationId: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
                archivedAt: true,
                isRoot: true,
                organizationId: true,
                role: true,
                positionTitle: true,
                jobPosition: { select: { name: true } },
                inviteToken: { select: { id: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        })
      : [],
    objects.length
      ? db.user.findMany({
          where: {
            organizationId: { in: objects.map((object) => object.id) },
            isActive: true,
            archivedAt: null,
            isRoot: false,
            id: { not: ownerUserId },
          },
          select: {
            id: true,
            name: true,
            organizationId: true,
            role: true,
            positionTitle: true,
            jobPosition: { select: { name: true, categoryKey: true } },
          },
          orderBy: { name: "asc" },
        })
      : [],
  ]);

  const peopleByCabinet = new Map<string, AccessPerson[]>(cabinetIds.map((id) => [id, []]));
  for (const user of legacy) {
    peopleByCabinet.get(user.organizationId)?.push({
      userId: user.id,
      name: user.name,
      email: user.email,
      kind: "invited",
      pending: !user.isActive,
      organizationName: null,
      title: null,
    });
  }
  for (const member of members) {
    const user = member.user;
    if (!user || user.isRoot || user.archivedAt || user.organizationId === member.organizationId) continue;
    // Неактивный без приглашения — выключенный сотрудник, не показываем.
    if (!user.isActive && !user.inviteToken) continue;
    peopleByCabinet.get(member.organizationId)?.push({
      userId: user.id,
      name: user.name,
      email: user.email,
      kind: "member",
      pending: !user.isActive,
      organizationName: objectName.get(user.organizationId) ?? null,
      title: getUserDisplayTitle(user),
    });
  }

  return {
    cabinets: cabinets.map((cabinet) => ({
      id: cabinet.id,
      name: cabinet.name,
      code: poolCodeOf(cabinet),
      people: peopleByCabinet.get(cabinet.id) ?? [],
    })),
    candidates: staff.map((user) => ({
      id: user.id,
      name: user.name,
      organizationName: objectName.get(user.organizationId) ?? "",
      title: getUserDisplayTitle(user),
      recommended: isRecommendedForCabinet(user.role, user.jobPosition?.categoryKey ?? null),
    })),
    organizations: objects.map((object) => ({ id: object.id, name: object.name, code: poolCodeOf(object) })),
  };
}

/** Дать доступ сотруднику объекта аккаунта: участие в кабинете. */
export async function grantCabinetAccess(input: {
  ownerUserId: string;
  cabinetId: unknown;
  userId: unknown;
}): Promise<{ cabinet: { id: string; name: string }; user: { id: string; name: string }; created: boolean }> {
  const accountId = await ownerAccountId(input.ownerUserId);
  const cabinet = await ownedCabinet(accountId, input.cabinetId);
  if (input.userId === input.ownerUserId) {
    throw new MasterCabinetError("У владельца аккаунта доступ ко всем кабинетам есть всегда", 400);
  }
  const user =
    typeof input.userId === "string" && input.userId
      ? await db.user.findFirst({
          where: {
            id: input.userId,
            isActive: true,
            archivedAt: null,
            isRoot: false,
            organization: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
          },
          select: { id: true, name: true },
        })
      : null;
  if (!user) throw new MasterCabinetError("Сотрудник не найден среди объектов аккаунта", 404);
  const existing = await db.organizationMember.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: cabinet.id } },
    select: { id: true },
  });
  if (!existing) {
    await db.organizationMember.create({ data: { userId: user.id, organizationId: cabinet.id, role: "manager" } });
  }
  return { cabinet, user, created: !existing };
}

export type CabinetInviteResult = MasterCabinetInvite & {
  cabinet: { id: string; name: string };
  organization: { id: string; name: string };
};

/**
 * Пригласить по почте: человек — сотрудник выбранной организации аккаунта
 * в группе «Мастер-кабинет» с доступом к кабинету. `beforeCreate` —
 * проверка мест тарифа этой организации.
 */
export async function inviteToCabinet(input: {
  ownerUserId: string;
  cabinetId: unknown;
  organizationId: unknown;
  name: unknown;
  email: unknown;
  beforeCreate?: (organizationId: string) => Promise<void>;
}): Promise<CabinetInviteResult> {
  const accountId = await ownerAccountId(input.ownerUserId);
  const cabinet = await ownedCabinet(accountId, input.cabinetId);
  const parsed = normalizeCabinetInvite(input.name, input.email);
  if (!parsed.ok) throw new MasterCabinetError(parsed.error, 400);
  const organization =
    typeof input.organizationId === "string" && input.organizationId
      ? await db.organization.findFirst({
          where: { id: input.organizationId, accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
          select: { id: true, name: true },
        })
      : null;
  if (!organization) {
    throw new MasterCabinetError("Выберите организацию: в её «Сотрудниках» будет приглашённый", 400);
  }
  const invite = await inviteMasterCabinetEmployee({
    cabinetId: cabinet.id,
    organizationId: organization.id,
    name: parsed.name,
    email: parsed.email,
    beforeCreate: input.beforeCreate,
  });
  return { ...invite, cabinet, organization };
}

/**
 * Убрать доступ. Сотрудник объекта — снять участие; кто был в WeSetup
 * только ради кабинета (группа «Мастер-кабинет» или прежний аккаунт
 * «только в кабинете») — ещё и в архив со ссылкой приглашения. Сессии
 * человека завершаются.
 */
export async function revokeCabinetAccess(input: {
  ownerUserId: string;
  cabinetId: unknown;
  userId: unknown;
}): Promise<{
  cabinet: { id: string; name: string };
  user: { id: string; name: string };
  kind: "invited" | "member";
  archived: boolean;
}> {
  const accountId = await ownerAccountId(input.ownerUserId);
  const cabinet = await ownedCabinet(accountId, input.cabinetId);
  if (typeof input.userId !== "string" || !input.userId || input.userId === input.ownerUserId) {
    throw new MasterCabinetError("У владельца аккаунта доступ не убирается", 400);
  }
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      name: true,
      organizationId: true,
      isRoot: true,
      lastActiveOrganizationId: true,
      jobPosition: { select: { name: true } },
    },
  });
  if (!user || user.isRoot) throw new MasterCabinetError("Человек не найден", 404);

  const archive = async () => {
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { archivedAt: new Date(), isActive: false } }),
      db.inviteToken.deleteMany({ where: { userId: user.id } }),
    ]);
  };

  if (user.organizationId === cabinet.id) {
    await archive();
    await bumpSessionVersion(user.id);
    return { cabinet, user: { id: user.id, name: user.name }, kind: "invited", archived: true };
  }

  const removed = await db.organizationMember.deleteMany({ where: { userId: user.id, organizationId: cabinet.id } });
  if (removed.count === 0) throw new MasterCabinetError("У этого человека нет доступа к кабинету", 404);
  if (user.lastActiveOrganizationId === cabinet.id) {
    await db.user.update({ where: { id: user.id }, data: { lastActiveOrganizationId: null } });
  }
  // Был в «Сотрудниках» только ради кабинета — больше нигде не работает.
  const onlyForCabinets =
    user.jobPosition?.name === MASTER_CABINET_POSITION_NAME &&
    (await db.organizationMember.count({
      where: { userId: user.id, organization: { kind: MASTER_ORG_KIND } },
    })) === 0;
  if (onlyForCabinets) await archive();
  await bumpSessionVersion(user.id);
  return { cabinet, user: { id: user.id, name: user.name }, kind: "member", archived: onlyForCabinets };
}
