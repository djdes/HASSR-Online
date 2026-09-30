import { db } from "@/lib/db";
import { buildInviteUrl, generateInviteToken, hashInviteToken, inviteExpiresAt } from "@/lib/invite-tokens";
import { MasterCabinetError } from "@/lib/master-cabinet";
import {
  isRecommendedForCabinet,
  normalizeCabinetInvite,
  type AccessCandidate,
  type AccessPerson,
  type CabinetAccess,
} from "@/lib/master-cabinet-access-view";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { bumpSessionVersion } from "@/lib/session-version";
import { getUserDisplayTitle } from "@/lib/user-roles";

/**
 * Доступ к мастер-кабинетам аккаунта — «Настройки → Права доступа →
 * Мастер-кабинеты» (владелец, 2026-09-30). Управляет владелец аккаунта:
 *   - пригласить по почте — новый аккаунт с домашней организацией-кабинетом:
 *     у человека есть только этот кабинет;
 *   - дать доступ сотруднику объекта — участие в кабинете
 *     (`OrganizationMember`), кабинет появляется у него в меню профиля;
 *   - убрать доступ — участие снимается / приглашённый уходит в архив,
 *     сессии завершаются (иначе открытый кабинет остался бы у него до выхода).
 */

export type AccountCabinetsAccess = { cabinets: CabinetAccess[]; candidates: AccessCandidate[] };

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

/** Кабинеты аккаунта с людьми и сотрудники объектов, которым можно дать доступ. */
export async function listAccountCabinetsAccess(ownerUserId: string): Promise<AccountCabinetsAccess> {
  const accountId = await ownerAccountId(ownerUserId);
  const [cabinets, objects] = await Promise.all([
    db.organization.findMany({
      where: { accountId, kind: MASTER_ORG_KIND },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.organization.findMany({
      where: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
      select: { id: true, name: true },
    }),
  ]);
  const objectName = new Map(objects.map((object) => [object.id, object.name]));
  const cabinetIds = cabinets.map((cabinet) => cabinet.id);

  const [invited, members, staff] = await Promise.all([
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
  for (const user of invited) {
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
    // Приглашённый по почте — уже в списке как «invited»; уволенных не показываем.
    if (!user || user.isRoot || user.archivedAt || !user.isActive || user.organizationId === member.organizationId) continue;
    peopleByCabinet.get(member.organizationId)?.push({
      userId: user.id,
      name: user.name,
      email: user.email,
      kind: "member",
      pending: false,
      organizationName: objectName.get(user.organizationId) ?? null,
      title: getUserDisplayTitle(user),
    });
  }

  return {
    cabinets: cabinets.map((cabinet) => ({ ...cabinet, people: peopleByCabinet.get(cabinet.id) ?? [] })),
    candidates: staff.map((user) => ({
      id: user.id,
      name: user.name,
      organizationName: objectName.get(user.organizationId) ?? "",
      title: getUserDisplayTitle(user),
      recommended: isRecommendedForCabinet(user.role, user.jobPosition?.categoryKey ?? null),
    })),
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

export type CabinetInviteResult = {
  cabinet: { id: string; name: string };
  user: { id: string; name: string; email: string };
  inviteUrl: string;
  /** Человек уже был приглашён (или убран) — выдана новая ссылка. */
  reinvited: boolean;
};

/**
 * Пригласить по почте — аккаунт только с этим кабинетом (домашняя
 * организация — кабинет, как у сотрудника бэк-офиса). `beforeCreate` —
 * проверка мест тарифа (только для нового человека).
 */
export async function inviteToCabinet(input: {
  ownerUserId: string;
  cabinetId: unknown;
  name: unknown;
  email: unknown;
  beforeCreate?: (cabinetId: string) => Promise<void>;
}): Promise<CabinetInviteResult> {
  const accountId = await ownerAccountId(input.ownerUserId);
  const cabinet = await ownedCabinet(accountId, input.cabinetId);
  const parsed = normalizeCabinetInvite(input.name, input.email);
  if (!parsed.ok) throw new MasterCabinetError(parsed.error, 400);

  const existingUser = await db.user.findFirst({
    where: { email: { equals: parsed.email, mode: "insensitive" } },
    select: { id: true, isActive: true, archivedAt: true, organizationId: true },
  });
  if (existingUser) {
    if (existingUser.organizationId !== cabinet.id) {
      throw new MasterCabinetError(
        "Этот email уже есть в WeSetup. Если это ваш сотрудник — дайте ему доступ через «Дать доступ сотруднику».",
        409
      );
    }
    if (existingUser.isActive && !existingUser.archivedAt) {
      throw new MasterCabinetError("У этого человека уже есть доступ к кабинету", 409);
    }
  } else if (input.beforeCreate) {
    await input.beforeCreate(cabinet.id);
  }

  const raw = generateInviteToken();
  const tokenHash = hashInviteToken(raw);
  const expiresAt = inviteExpiresAt();
  const user = await db.$transaction(async (tx) => {
    const saved = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: { name: parsed.name, isActive: false, archivedAt: null },
          select: { id: true, name: true, email: true },
        })
      : await tx.user.create({
          data: {
            name: parsed.name,
            email: parsed.email,
            passwordHash: "",
            role: "manager",
            organizationId: cabinet.id,
            isActive: false,
          },
          select: { id: true, name: true, email: true },
        });
    // Приглашение у человека одно (InviteToken.userId уникален): прежняя ссылка перестаёт действовать.
    await tx.inviteToken.deleteMany({ where: { userId: saved.id } });
    await tx.inviteToken.create({ data: { userId: saved.id, tokenHash, expiresAt } });
    return saved;
  });

  return { cabinet, user, inviteUrl: buildInviteUrl(raw), reinvited: Boolean(existingUser) };
}

/**
 * Убрать доступ: сотруднику объекта — снять участие; приглашённому по почте —
 * в архив (у него нет ничего, кроме кабинета). Сессии человека завершаются.
 */
export async function revokeCabinetAccess(input: {
  ownerUserId: string;
  cabinetId: unknown;
  userId: unknown;
}): Promise<{ cabinet: { id: string; name: string }; user: { id: string; name: string }; kind: "invited" | "member" }> {
  const accountId = await ownerAccountId(input.ownerUserId);
  const cabinet = await ownedCabinet(accountId, input.cabinetId);
  if (typeof input.userId !== "string" || !input.userId || input.userId === input.ownerUserId) {
    throw new MasterCabinetError("У владельца аккаунта доступ не убирается", 400);
  }
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, organizationId: true, isRoot: true, lastActiveOrganizationId: true },
  });
  if (!user || user.isRoot) throw new MasterCabinetError("Человек не найден", 404);

  if (user.organizationId === cabinet.id) {
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { archivedAt: new Date(), isActive: false } }),
      db.inviteToken.deleteMany({ where: { userId: user.id } }),
    ]);
    await bumpSessionVersion(user.id);
    return { cabinet, user: { id: user.id, name: user.name }, kind: "invited" };
  }

  const removed = await db.organizationMember.deleteMany({ where: { userId: user.id, organizationId: cabinet.id } });
  if (removed.count === 0) throw new MasterCabinetError("У этого человека нет доступа к кабинету", 404);
  if (user.lastActiveOrganizationId === cabinet.id) {
    await db.user.update({ where: { id: user.id }, data: { lastActiveOrganizationId: null } });
  }
  await bumpSessionVersion(user.id);
  return { cabinet, user: { id: user.id, name: user.name }, kind: "member" };
}
