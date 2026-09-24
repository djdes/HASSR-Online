import { db } from "@/lib/db";
import { ensureServiceCode, resolveDishPoolOrgIds } from "@/lib/dish-pool";
import { buildInviteUrl, generateInviteToken, hashInviteToken, inviteExpiresAt } from "@/lib/invite-tokens";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { assertOrgMembership } from "@/lib/organization-access";

/**
 * Создание мастер-кабинета справочников из настроек пищеблока
 * (`/api/settings/master-cabinet`). Кабинет — отдельная организация
 * `kind="directory"`, привязанная к коду пула; сотрудник бэк-офиса
 * приглашается в неё обычным `InviteToken` (как `/api/users/invite`).
 */

export type MasterCabinetUser = { id: string; name: string; email: string; invited: boolean };

export type MasterCabinetStatus = {
  code: string | null;
  poolOrganizations: Array<{ id: string; name: string }>;
  master: null | {
    organizationId: string;
    name: string;
    users: MasterCabinetUser[];
    /** Может ли смотрящий переключиться в кабинет (член кабинета). */
    viewerCanOpen: boolean;
  };
};

function poolCodeOf(org: { serviceCode: string | null; linkedServiceCode: string | null } | null): string | null {
  return org?.linkedServiceCode ?? org?.serviceCode ?? null;
}

async function findMasterInPool(poolIds: string[]) {
  return db.organization.findFirst({
    where: { id: { in: poolIds }, kind: MASTER_ORG_KIND },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
}

async function listMasterUsers(masterOrgId: string): Promise<MasterCabinetUser[]> {
  const users = await db.user.findMany({
    where: { organizationId: masterOrgId, isRoot: false, archivedAt: null },
    select: { id: true, name: true, email: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return users.map((user) => ({ id: user.id, name: user.name, email: user.email, invited: !user.isActive }));
}

export async function getMasterCabinetStatus(
  organizationId: string,
  viewerUserId?: string
): Promise<MasterCabinetStatus> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { serviceCode: true, linkedServiceCode: true },
  });
  const code = poolCodeOf(org);
  if (!code) return { code: null, poolOrganizations: [], master: null };
  const poolIds = await resolveDishPoolOrgIds(organizationId);
  const [poolOrganizations, master] = await Promise.all([
    db.organization.findMany({
      where: { id: { in: poolIds }, ...NOT_DIRECTORY_ORG_WHERE },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    findMasterInPool(poolIds),
  ]);
  return {
    code,
    poolOrganizations,
    master: master
      ? {
          organizationId: master.id,
          name: master.name,
          users: await listMasterUsers(master.id),
          viewerCanOpen: viewerUserId ? await assertOrgMembership(viewerUserId, master.id) : false,
        }
      : null,
  };
}

export class MasterCabinetError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Все коды журналов — кабинет журналы не ведёт, все выключены. */
async function allJournalCodes(): Promise<string[]> {
  const templates = await db.journalTemplate.findMany({ select: { code: true } });
  return [...new Set([...ACTIVE_JOURNAL_CATALOG.map((item) => item.code), ...templates.map((t) => t.code)])];
}

export type CreateMasterCabinetResult = {
  created: boolean;
  masterOrganizationId: string;
  masterName: string;
  code: string;
  user: { id: string; name: string; email: string };
  inviteUrl: string;
  /** Человек уже был приглашён в кабинет и ещё не вошёл — выдана новая ссылка. */
  reinvited: boolean;
};

/**
 * Кабинет в пуле организации (создать, если его нет) + приглашение
 * сотрудника бэк-офиса. Второй кабинет в пуле не создаётся — только
 * приглашение в существующий.
 */
export async function createOrInviteMasterCabinet(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
  email: string;
}): Promise<CreateMasterCabinetResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.replace(/\s+/g, " ").trim();

  const org = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, type: true, isDemo: true, kind: true, accountId: true, serviceCode: true, linkedServiceCode: true },
  });
  if (!org) throw new MasterCabinetError("Организация не найдена", 404);
  if (org.kind === MASTER_ORG_KIND) throw new MasterCabinetError("Это уже мастер-кабинет", 400);
  if (org.isDemo) throw new MasterCabinetError("В демо-организации мастер-кабинет не создаётся", 400);

  // 1. Код пула: нет ни своего, ни чужого — выдаём свой.
  if (!org.serviceCode && !org.linkedServiceCode) await ensureServiceCode(org.id);
  const fresh = await db.organization.findUnique({
    where: { id: org.id },
    select: { serviceCode: true, linkedServiceCode: true },
  });
  const code = poolCodeOf(fresh);
  if (!code) throw new MasterCabinetError("Не удалось выдать код справочника", 500);

  // 4a. Email занят — понятный отказ; тот же человек, ещё не вошедший в кабинет, — новая ссылка.
  const existingUser = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, name: true, email: true, isActive: true, organizationId: true },
  });

  const poolIds = await resolveDishPoolOrgIds(org.id);
  const existingMaster = await findMasterInPool(poolIds);

  if (existingUser) {
    const sameCabinet = existingMaster && existingUser.organizationId === existingMaster.id;
    if (!sameCabinet) {
      throw new MasterCabinetError(
        "Этот email уже занят другим пользователем WeSetup. Укажите другой адрес для сотрудника бэк-офиса.",
        409
      );
    }
    if (existingUser.isActive) {
      throw new MasterCabinetError("Этот сотрудник уже работает в мастер-кабинете", 409);
    }
  }

  const raw = generateInviteToken();
  const tokenHash = hashInviteToken(raw);
  const expiresAt = inviteExpiresAt();
  const rootOwner = await db.organization.findFirst({ where: { serviceCode: code }, select: { name: true, type: true } });
  const disabledCodes = existingMaster ? [] : await allJournalCodes();
  const accountOwner = org.accountId
    ? await db.account.findUnique({ where: { id: org.accountId }, select: { ownerUserId: true } })
    : null;

  const result = await db.$transaction(async (tx) => {
    // 3. Кабинет — прямой create: без засева журналов, триала и писем create-organization.ts.
    const master =
      existingMaster ??
      (await tx.organization.create({
        data: {
          name: `Мастер-кабинет — ${rootOwner?.name ?? org.name}`,
          type: rootOwner?.type ?? org.type,
          kind: MASTER_ORG_KIND,
          linkedServiceCode: code,
          accountId: org.accountId,
          disabledJournalCodes: disabledCodes,
        },
        select: { id: true, name: true },
      }));

    // Владелец аккаунта и тот, кто создаёт кабинет, могут в него переключаться.
    const memberIds = new Set<string>([input.actorUserId]);
    if (accountOwner?.ownerUserId) memberIds.add(accountOwner.ownerUserId);
    const members = await tx.user.findMany({
      where: { id: { in: [...memberIds] }, isRoot: false },
      select: { id: true },
    });
    for (const member of members) {
      await tx.organizationMember.upsert({
        where: { userId_organizationId: { userId: member.id, organizationId: master.id } },
        create: {
          userId: member.id,
          organizationId: master.id,
          role: member.id === accountOwner?.ownerUserId ? "owner" : "manager",
        },
        update: {},
      });
    }

    // 4. Сотрудник бэк-офиса — руководитель кабинета, вход по приглашению.
    const user =
      existingUser ??
      (await tx.user.create({
        data: {
          name,
          email,
          passwordHash: "",
          role: "manager",
          organizationId: master.id,
          isActive: false,
        },
        select: { id: true, name: true, email: true },
      }));
    if (existingUser) {
      // Приглашение у человека одно (InviteToken.userId уникален): прежняя
      // ссылка перестаёт действовать, работает только новая.
      await tx.inviteToken.deleteMany({ where: { userId: existingUser.id } });
    }
    await tx.inviteToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
    return { master, user };
  });

  return {
    created: !existingMaster,
    masterOrganizationId: result.master.id,
    masterName: result.master.name,
    code,
    user: { id: result.user.id, name: result.user.name, email: result.user.email },
    inviteUrl: buildInviteUrl(raw),
    reinvited: Boolean(existingUser),
  };
}
