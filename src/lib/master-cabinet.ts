import { db } from "@/lib/db";
import { ensureServiceCode, resolveDishPoolOrgIds } from "@/lib/dish-pool";
import { generateServiceCode } from "@/lib/dish-pool-code";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import {
  mapObjectsToCabinets,
  MASTER_CABINET_OBJECTS_MAX,
  normalizeObjectIds,
  poolCodeOf,
  summarizeMasterCabinetChoice,
  type MasterCabinetChoiceSummary,
  type MasterCabinetObject,
} from "@/lib/master-cabinet-choice";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { MasterCabinetError } from "@/lib/master-cabinet-error";
import { inviteMasterCabinetEmployee } from "@/lib/master-cabinet-staff";
import { assertOrgMembership, listAccessibleOrganizations } from "@/lib/organization-access";

export { MasterCabinetError } from "@/lib/master-cabinet-error";

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

async function findMasterInPool(poolIds: string[]) {
  return db.organization.findFirst({
    where: { id: { in: poolIds }, kind: MASTER_ORG_KIND },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
}

async function listMasterUsers(masterOrgId: string): Promise<MasterCabinetUser[]> {
  // Люди кабинета: прежние аккаунты «только в кабинете» и сотрудники
  // организаций с доступом (владелец аккаунта не показывается — доступ у
  // него всегда). Приглашённый сотрудник, ещё не задавший пароль, — «invited».
  const [homeUsers, members] = await Promise.all([
    db.user.findMany({
      where: { organizationId: masterOrgId, isRoot: false, archivedAt: null },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    db.organizationMember.findMany({
      where: { organizationId: masterOrgId, role: { not: "owner" } },
      select: {
        user: { select: { id: true, name: true, email: true, isActive: true, archivedAt: true, isRoot: true, organizationId: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const seen = new Set(homeUsers.map((user) => user.id));
  const people = homeUsers.map((user) => ({ id: user.id, name: user.name, email: user.email, invited: !user.isActive }));
  for (const { user } of members) {
    if (!user || user.isRoot || user.archivedAt || seen.has(user.id) || user.organizationId === masterOrgId) continue;
    seen.add(user.id);
    people.push({ id: user.id, name: user.name, email: user.email, invited: !user.isActive });
  }
  return people;
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
 * человека по почте. Второй кабинет в том же пуле не создаётся — только
 * приглашение в существующий; ещё один кабинет со своим кодом создаёт
 * владелец аккаунта из меню профиля (`createAccountMasterCabinet`).
 * Приглашённый — сотрудник этой организации в группе «Мастер-кабинет»
 * (`inviteMasterCabinetEmployee`); `beforeCreate` — проверка мест тарифа.
 */
export async function createOrInviteMasterCabinet(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
  email: string;
  beforeCreate?: (organizationId: string) => Promise<void>;
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

  const poolIds = await resolveDishPoolOrgIds(org.id);
  const existingMaster = await findMasterInPool(poolIds);

  // 2. Email занят другим человеком — отказ до создания кабинета (подробные
  //    правила повтора — в inviteMasterCabinetEmployee).
  const existingUser = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, isActive: true, archivedAt: true, organizationId: true },
  });
  if (existingUser && existingUser.isActive && !existingUser.archivedAt) {
    throw new MasterCabinetError(
      existingMaster && existingUser.organizationId === existingMaster.id
        ? "Этот сотрудник уже работает в мастер-кабинете"
        : "Этот email уже занят другим пользователем WeSetup. Укажите другой адрес для сотрудника бэк-офиса.",
      409
    );
  }
  if (!existingMaster && existingUser && existingUser.organizationId !== org.id) {
    throw new MasterCabinetError(
      "Этот email уже занят другим пользователем WeSetup. Укажите другой адрес для сотрудника бэк-офиса.",
      409
    );
  }

  const rootOwner = await db.organization.findFirst({ where: { serviceCode: code }, select: { name: true, type: true } });
  const disabledCodes = existingMaster ? [] : await allJournalCodes();
  const accountOwner = org.accountId
    ? await db.account.findUnique({ where: { id: org.accountId }, select: { ownerUserId: true } })
    : null;

  // 3. Кабинет — прямой create: без засева журналов, триала и писем create-organization.ts.
  const master = await db.$transaction(async (tx) => {
    const cabinet =
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
        where: { userId_organizationId: { userId: member.id, organizationId: cabinet.id } },
        create: {
          userId: member.id,
          organizationId: cabinet.id,
          role: member.id === accountOwner?.ownerUserId ? "owner" : "manager",
        },
        update: {},
      });
    }
    return cabinet;
  });

  // 4. Человек — сотрудник этой организации в группе «Мастер-кабинет».
  const invite = await inviteMasterCabinetEmployee({
    cabinetId: master.id,
    organizationId: org.id,
    name,
    email,
    beforeCreate: input.beforeCreate,
  });

  return {
    created: !existingMaster,
    masterOrganizationId: master.id,
    masterName: master.name,
    code,
    user: invite.user,
    inviteUrl: invite.inviteUrl,
    reinvited: invite.reinvited,
  };
}

/* ─────────── Название кабинета ─────────── */

export const MASTER_CABINET_NAME_MIN = 2;
export const MASTER_CABINET_NAME_MAX = 120;

/** Название кабинета: пробелы схлопнуты; короче 2 или длиннее 120 символов — null. */
export function normalizeMasterCabinetName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < MASTER_CABINET_NAME_MIN || name.length > MASTER_CABINET_NAME_MAX) return null;
  return name;
}

/**
 * Переименовать мастер-кабинет (организацию `kind="directory"`). Имя при
 * создании собирается как «Мастер-кабинет — <организация>»; дальше его
 * меняют сотрудник кабинета (шапка `/master`) или владелец пищеблока
 * (`/settings/master-cabinet`).
 */
export async function renameMasterCabinet(
  masterOrgId: string,
  rawName: unknown
): Promise<{ previousName: string; name: string; changed: boolean }> {
  const name = normalizeMasterCabinetName(rawName);
  if (!name) {
    throw new MasterCabinetError(
      `Название — от ${MASTER_CABINET_NAME_MIN} до ${MASTER_CABINET_NAME_MAX} символов`,
      400
    );
  }
  const org = await db.organization.findUnique({ where: { id: masterOrgId }, select: { name: true, kind: true } });
  if (!org || org.kind !== MASTER_ORG_KIND) throw new MasterCabinetError("Мастер-кабинет не найден", 404);
  if (org.name === name) return { previousName: org.name, name, changed: false };
  await db.organization.update({ where: { id: masterOrgId }, data: { name } });
  return { previousName: org.name, name, changed: true };
}

/* ─────────── Кабинеты аккаунта: «Создать мастер-кабинет» в меню профиля ─────────── */

async function ownedAccountId(ownerUserId: string): Promise<string> {
  const account = await db.account.findUnique({ where: { ownerUserId }, select: { id: true } });
  if (!account) throw new MasterCabinetError("Создавать мастер-кабинеты может только владелец аккаунта", 403);
  return account.id;
}

/**
 * Объекты аккаунта (без демо и кабинетов, только доступные владельцу) и
 * кабинет, из которого каждый сейчас получает меню и сырьё.
 */
export async function listAccountMasterCabinetObjects(ownerUserId: string): Promise<MasterCabinetObject[]> {
  const accountId = await ownedAccountId(ownerUserId);
  const [objects, accessible] = await Promise.all([
    db.organization.findMany({
      where: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
      select: { id: true, name: true, serviceCode: true, linkedServiceCode: true },
      orderBy: { name: "asc" },
    }),
    listAccessibleOrganizations(ownerUserId),
  ]);
  const accessibleIds = new Set(accessible.map((item) => item.id));
  const own = objects.filter((object) => accessibleIds.has(object.id));
  const codes = [...new Set(own.map(poolCodeOf).filter((code): code is string => Boolean(code)))];
  const cabinets = codes.length
    ? await db.organization.findMany({
        where: {
          kind: MASTER_ORG_KIND,
          OR: [{ linkedServiceCode: { in: codes } }, { serviceCode: { in: codes }, linkedServiceCode: null }],
        },
        select: { id: true, name: true, serviceCode: true, linkedServiceCode: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  return mapObjectsToCabinets(own, cabinets);
}

/** Свободный код справочника для нового кабинета. */
async function freeServiceCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateServiceCode();
    const taken = await db.organization.findUnique({ where: { serviceCode: code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new MasterCabinetError("Не удалось выдать код справочника — попробуйте ещё раз", 500);
}

export type CreateAccountMasterCabinetResult = {
  id: string;
  name: string;
  code: string;
  organizationIds: string[];
  summary: MasterCabinetChoiceSummary;
};

/**
 * Новый мастер-кабинет аккаунта — сколько угодно кабинетов (например,
 * «Школы» и «Сады»). У кабинета свой код справочника; отмеченные объекты
 * подключаются к нему и дальше получают меню и сырьё только отсюда (из
 * прежнего кабинета — больше нет). Владелец аккаунта — участник кабинета
 * и переключается в него из меню профиля. Сотрудника бэк-офиса можно
 * пригласить позже — «Настройки → Мастер-кабинет» у любого из объектов.
 */
export async function createAccountMasterCabinet(input: {
  ownerUserId: string;
  name: unknown;
  organizationIds: unknown;
}): Promise<CreateAccountMasterCabinetResult> {
  const accountId = await ownedAccountId(input.ownerUserId);
  const name = normalizeMasterCabinetName(input.name);
  if (!name) {
    throw new MasterCabinetError(
      `Название — от ${MASTER_CABINET_NAME_MIN} до ${MASTER_CABINET_NAME_MAX} символов`,
      400
    );
  }
  const requested = normalizeObjectIds(input.organizationIds);
  if (requested.length > MASTER_CABINET_OBJECTS_MAX) {
    throw new MasterCabinetError(`В одном кабинете — не больше ${MASTER_CABINET_OBJECTS_MAX} объектов`, 400);
  }
  const objects = await listAccountMasterCabinetObjects(input.ownerUserId);
  const known = new Set(objects.map((object) => object.id));
  if (requested.some((id) => !known.has(id))) {
    throw new MasterCabinetError("Среди отмеченных есть объект не из вашего аккаунта", 400);
  }

  const typeSource = await db.organization.findFirst({
    where: { id: { in: requested.length > 0 ? requested : [...known] } },
    select: { type: true },
  });
  const [code, disabledCodes] = await Promise.all([freeServiceCode(), allJournalCodes()]);

  const master = await db.$transaction(async (tx) => {
    // Прямой create, как в createOrInviteMasterCabinet: без засева журналов,
    // триала и писем create-organization.ts.
    const created = await tx.organization.create({
      data: {
        name,
        type: typeSource?.type ?? "other",
        kind: MASTER_ORG_KIND,
        serviceCode: code,
        accountId,
        disabledJournalCodes: disabledCodes,
      },
      select: { id: true, name: true },
    });
    await tx.organizationMember.create({
      data: { userId: input.ownerUserId, organizationId: created.id, role: "owner" },
    });
    if (requested.length > 0) {
      await tx.organization.updateMany({ where: { id: { in: requested } }, data: { linkedServiceCode: code } });
    }
    return created;
  });

  return {
    id: master.id,
    name: master.name,
    code,
    organizationIds: requested,
    summary: summarizeMasterCabinetChoice(objects, requested),
  };
}
