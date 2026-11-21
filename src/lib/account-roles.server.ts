import type { Session } from "next-auth";

import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { pointScopeForUser } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { isPointScoped } from "@/lib/point-scope";
import { computePointScope } from "@/lib/point-scope.server";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { MANAGEMENT_ROLES, getDbRoleValuesWithLegacy, isManagementRole } from "@/lib/user-roles";

import {
  canManageNetworkRole,
  decideAppointment,
  hasAccountFullAccess,
  isAccountOwnerRole,
  resolveAccountRole,
  type AccountRole,
} from "./account-roles";

/**
 * Роли в аккаунте (серия E, Р5) по базе: владелец аккаунта и назначенные
 * им управляющие сетью. Каждая проверка читает базу заново — снятие
 * управляющего, увольнение или архив отбирают права сразу, без перевхода.
 * Сессионные запреты («войти как», руководитель точки, нет полного доступа)
 * проверяют маршруты и страницы.
 */

export type { AccountRole } from "./account-roles";

const platformOrgId = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

/** Рабочие организации аккаунта: без демо, мастер-кабинетов и платформы. */
function workingOrgWhere(accountId: string) {
  return { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE, id: { not: platformOrgId() } };
}

/** Полный доступ человека хотя бы в одной рабочей организации аккаунта (сейчас, по базе). */
async function hasFullAccessInAccount(userId: string, accountId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      archivedAt: true,
      isRoot: true,
      role: true,
      organizationId: true,
      buildingIds: true,
      organization: { select: { id: true, accountId: true, isDemo: true, kind: true } },
      organizationMemberships: { where: { organization: workingOrgWhere(accountId) }, select: { id: true } },
    },
  });
  if (!user) return false;
  const home = user.organization;
  const homeInAccount =
    home.accountId === accountId && !home.isDemo && home.kind !== MASTER_ORG_KIND && home.id !== platformOrgId();
  const homeManagement = isManagementRole(user.role);
  const homePointScoped =
    homeInAccount && homeManagement && user.buildingIds.length > 0
      ? (await computePointScope({ organizationId: user.organizationId, buildingIds: user.buildingIds })) !== null
      : false;
  return hasAccountFullAccess({
    isActive: user.isActive,
    archivedAt: user.archivedAt,
    isRoot: user.isRoot,
    homeInAccount,
    homeManagement,
    homePointScoped,
    accountMemberships: user.organizationMemberships.length,
  });
}

async function roleWithOwner(userId: string, accountId: string, ownerUserId: string): Promise<AccountRole | null> {
  if (ownerUserId === userId) return "owner";
  const appointed = await db.accountNetworkManager.findUnique({
    where: { accountId_userId: { accountId, userId } },
    select: { id: true },
  });
  if (!appointed) return null;
  return resolveAccountRole({
    userId,
    ownerUserId,
    appointed: true,
    fullAccess: await hasFullAccessInAccount(userId, accountId),
  });
}

/** Роль человека в аккаунте: «owner», «network_manager» или null. */
export async function accountRoleOf(userId: string, accountId: string): Promise<AccountRole | null> {
  const account = await db.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } });
  if (!account) return null;
  return roleWithOwner(userId, accountId, account.ownerUserId);
}

/** Владелец или действующий управляющий сетью аккаунта. */
export async function canManageNetwork(userId: string, accountId: string): Promise<boolean> {
  return canManageNetworkRole(await accountRoleOf(userId, accountId));
}

export type OrganizationAccountRole = {
  accountId: string;
  ownerUserId: string;
  role: AccountRole | null;
};

/**
 * Аккаунт организации (обычно — активной организации сессии) и роль в нём
 * человека. Организация без аккаунта или не найдена — null.
 */
export async function accountRoleForOrganization(userId: string, organizationId: string): Promise<OrganizationAccountRole | null> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { accountId: true, account: { select: { ownerUserId: true } } },
  });
  if (!organization?.accountId || !organization.account) return null;
  return {
    accountId: organization.accountId,
    ownerUserId: organization.account.ownerUserId,
    role: await roleWithOwner(userId, organization.accountId, organization.account.ownerUserId),
  };
}

/* ─────────────────────────── назначение ─────────────────────────── */

export type NetworkManagerPerson = {
  userId: string;
  name: string;
  email: string;
  /** Организации аккаунта, где у человека полный доступ. */
  organizations: string[];
};

export type NetworkManagerRow = NetworkManagerPerson & {
  /** Права действуют: полный доступ в организациях аккаунта сохранился. */
  active: boolean;
  createdAt: string;
};

export type NetworkManagersView = {
  managers: NetworkManagerRow[];
  /** Кого можно назначить: руководители организаций аккаунта, кроме владельца и уже назначенных. */
  candidates: NetworkManagerPerson[];
};

/** Сколько кандидатов отдаём списку выбора. */
const CANDIDATES_MAX = 500;

/**
 * Все, у кого сейчас полный доступ в рабочих организациях аккаунта, кроме
 * владельца: руководители всей компании дома (не руководители точки) и
 * участники организаций. Те же правила, что `hasFullAccessInAccount`, одним
 * проходом.
 */
async function eligiblePeople(accountId: string, ownerUserId: string): Promise<Map<string, NetworkManagerPerson>> {
  const orgs = await db.organization.findMany({
    where: workingOrgWhere(accountId),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, perLocationJournals: true, buildings: { select: { id: true, kind: true } } },
  });
  const orgById = new Map(orgs.map((org) => [org.id, org]));
  const orgIds = orgs.map((org) => org.id);
  if (orgIds.length === 0) return new Map();
  const activeUser = { isActive: true, archivedAt: null, isRoot: false } as const;
  const [homeUsers, members] = await Promise.all([
    db.user.findMany({
      where: { organizationId: { in: orgIds }, ...activeUser, role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) } },
      select: { id: true, name: true, email: true, role: true, organizationId: true, buildingIds: true },
    }),
    db.organizationMember.findMany({
      where: { organizationId: { in: orgIds }, user: activeUser },
      select: { organizationId: true, user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const people = new Map<string, NetworkManagerPerson>();
  const add = (user: { id: string; name: string; email: string }, organizationId: string) => {
    if (user.id === ownerUserId) return;
    const orgName = orgById.get(organizationId)?.name ?? "";
    const known = people.get(user.id);
    if (known) {
      if (orgName && !known.organizations.includes(orgName)) known.organizations.push(orgName);
      return;
    }
    people.set(user.id, { userId: user.id, name: user.name, email: user.email, organizations: orgName ? [orgName] : [] });
  };
  for (const user of homeUsers) {
    if (!isManagementRole(user.role)) continue;
    const org = orgById.get(user.organizationId);
    if (!org) continue;
    const scoped = pointScopeForUser({ enabled: org.perLocationJournals, buildings: org.buildings, userBuildingIds: user.buildingIds });
    if (scoped) continue;
    add(user, user.organizationId);
  }
  for (const member of members) add(member.user, member.organizationId);
  return people;
}

/** Управляющие аккаунта и кандидаты для «Управляющие сетью» (страница «Сеть», владелец). */
export async function loadNetworkManagers(accountId: string): Promise<NetworkManagersView> {
  const account = await db.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } });
  if (!account) return { managers: [], candidates: [] };
  const [rows, eligible] = await Promise.all([
    db.accountNetworkManager.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { userId: true, createdAt: true },
    }),
    eligiblePeople(accountId, account.ownerUserId),
  ]);
  const users = rows.length
    ? await db.user.findMany({ where: { id: { in: rows.map((row) => row.userId) } }, select: { id: true, name: true, email: true } })
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));
  const appointed = new Set(rows.map((row) => row.userId));
  const managers = rows.map((row) => {
    const person = eligible.get(row.userId);
    const user = userById.get(row.userId);
    return {
      userId: row.userId,
      name: person?.name ?? user?.name ?? "",
      email: person?.email ?? user?.email ?? "",
      organizations: person?.organizations ?? [],
      active: Boolean(person),
      createdAt: row.createdAt.toISOString(),
    };
  });
  const candidates = [...eligible.values()]
    .filter((person) => !appointed.has(person.userId))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .slice(0, CANDIDATES_MAX);
  return { managers, candidates };
}

/** Id действующих управляющих сети аккаунта (для писем и уведомлений). */
export async function listActiveNetworkManagerIds(accountId: string): Promise<string[]> {
  const rows = await db.accountNetworkManager.findMany({ where: { accountId }, select: { userId: true } });
  const checked = await Promise.all(
    rows.map(async (row) => ((await hasFullAccessInAccount(row.userId, accountId)) ? row.userId : null)),
  );
  return checked.filter((id): id is string => id !== null);
}

export class NetworkManagerError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: "not_owner" | "owner" | "already" | "not_eligible" | "limit" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "NetworkManagerError";
  }
}

const APPOINT_MESSAGES = {
  owner: "Владелец аккаунта и так управляет сетью",
  already: "Этот человек уже управляющий сетью",
  not_eligible: "Назначить можно руководителя организации аккаунта с полным доступом",
  limit: "Управляющих сетью уже слишком много — снимите кого-нибудь",
} as const;

type ManagerActor = {
  accountId: string;
  /** Владелец аккаунта: назначает и снимает только он. */
  ownerUserId: string;
  ownerName?: string | null;
  /** Активная организация владельца — в её журнал пишется действие. */
  organizationId: string;
  ipAddress?: string | null;
};

async function assertOwner(actor: ManagerActor): Promise<void> {
  if ((await accountRoleOf(actor.ownerUserId, actor.accountId)) !== "owner") {
    throw new NetworkManagerError(403, "not_owner", "Назначать управляющих сетью может только владелец аккаунта");
  }
}

async function writeAudit(actor: ManagerActor, action: string, person: { userId: string; name: string; email: string }) {
  try {
    await db.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.ownerUserId,
        userName: actor.ownerName ?? null,
        action,
        entity: "account",
        entityId: actor.accountId,
        details: { accountId: actor.accountId, managerUserId: person.userId, managerName: person.name, managerEmail: person.email },
        ipAddress: actor.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error("[network-managers] audit failed", { accountId: actor.accountId, error });
  }
}

/** Назначить управляющего сетью. Только владелец; только кандидат из `loadNetworkManagers`. */
export async function appointNetworkManager(actor: ManagerActor, userId: string): Promise<NetworkManagerPerson> {
  await assertOwner(actor);
  const [rows, eligible] = await Promise.all([
    db.accountNetworkManager.findMany({ where: { accountId: actor.accountId }, select: { userId: true } }),
    eligiblePeople(actor.accountId, actor.ownerUserId),
  ]);
  const decision = decideAppointment({
    userId,
    ownerUserId: actor.ownerUserId,
    appointedIds: new Set(rows.map((row) => row.userId)),
    eligibleIds: new Set(eligible.keys()),
  });
  if (!decision.ok) {
    throw new NetworkManagerError(decision.reason === "not_eligible" ? 404 : 409, decision.reason, APPOINT_MESSAGES[decision.reason]);
  }
  const person = eligible.get(userId)!;
  try {
    await db.accountNetworkManager.create({
      data: { accountId: actor.accountId, userId, grantedByUserId: actor.ownerUserId },
    });
  } catch (error) {
    // Двойное нажатие: строка уже есть — это тот же результат.
    if ((error as { code?: string } | null)?.code === "P2002") {
      throw new NetworkManagerError(409, "already", APPOINT_MESSAGES.already);
    }
    throw error;
  }
  await writeAudit(actor, "account.network_manager_added", person);
  return person;
}

/** Снять управляющего сетью: права пропадают сразу. Только владелец; не назначен — 404. */
export async function removeNetworkManager(actor: ManagerActor, userId: string): Promise<void> {
  await assertOwner(actor);
  const removed = await db.accountNetworkManager.deleteMany({ where: { accountId: actor.accountId, userId } });
  if (removed.count === 0) throw new NetworkManagerError(404, "not_found", "Управляющий не найден");
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  await writeAudit(actor, "account.network_manager_removed", { userId, name: user?.name ?? "", email: user?.email ?? "" });
}

/* ─────────────────────────── сессия ─────────────────────────── */

export type NetworkOwnerSession =
  | { ok: true; accountId: string; organizationId: string; ownerUserId: string; ownerName: string | null }
  | { ok: false; status: 403 | 404; error: string };

/**
 * «Управляющие сетью» (`/api/settings/network/managers`): владелец аккаунта
 * активной организации с полным доступом, не в «войти как» и не
 * руководитель точки. Управляющему сетью — 403: назначает только владелец.
 */
export async function networkOwnerForSession(session: Session): Promise<NetworkOwnerSession> {
  const user = session.user;
  if (!hasFullWorkspaceAccess(user) || isImpersonating(session) || isPointScoped(user)) {
    return { ok: false, status: 403, error: "Нет доступа" };
  }
  const organizationId = getActiveOrgId(session);
  const access = await accountRoleForOrganization(user.id, organizationId);
  if (!access) return { ok: false, status: 404, error: "Организация не найдена" };
  if (!isAccountOwnerRole(access.role)) {
    return { ok: false, status: 403, error: "Назначать управляющих сетью может только владелец аккаунта" };
  }
  return { ok: true, accountId: access.accountId, organizationId, ownerUserId: user.id, ownerName: user.name ?? user.email ?? null };
}
