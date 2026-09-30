import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { masterCabinetSeatsPerOrg, poolCodeOf } from "@/lib/master-cabinet-choice";

/**
 * Места тарифа мастер-кабинетов (владелец, 2026-09-30): кабинет, где есть
 * люди с доступом (кроме владельца аккаунта), — +1 сотрудник в каждой
 * организации аккаунта, подключённой к нему по коду справочника;
 * отключилась — место уходит само. Люди группы «Мастер-кабинет» мест не
 * занимают (`NOT_MASTER_CABINET_STAFF_WHERE`) — иначе они считались бы
 * дважды. Правило — `masterCabinetSeatsPerOrg`.
 */

/** Имя группы — как в `master-cabinet-staff.ts` (без импорта: тот модуль тянет приглашения). */
const MASTER_CABINET_POSITION_NAME = "Мастер-кабинет";

export const NOT_MASTER_CABINET_STAFF_WHERE: Prisma.UserWhereInput = {
  NOT: { jobPosition: { is: { name: MASTER_CABINET_POSITION_NAME } } },
};

/** Кабинеты аккаунтов с признаком «есть люди с доступом». */
async function loadCabinets(accountIds: string[]) {
  if (accountIds.length === 0) return [];
  const cabinets = await db.organization.findMany({
    where: { kind: "directory", accountId: { in: accountIds } },
    select: { id: true, accountId: true, serviceCode: true, linkedServiceCode: true, account: { select: { ownerUserId: true } } },
  });
  if (cabinets.length === 0) return [];
  const ids = cabinets.map((cabinet) => cabinet.id);
  const [homes, members] = await Promise.all([
    db.user.findMany({
      where: { organizationId: { in: ids }, isActive: true, archivedAt: null, isRoot: false },
      select: { organizationId: true },
    }),
    db.organizationMember.findMany({
      where: { organizationId: { in: ids }, user: { isActive: true, archivedAt: null, isRoot: false } },
      select: { organizationId: true, userId: true },
    }),
  ]);
  const ownerOf = new Map(cabinets.map((cabinet) => [cabinet.id, cabinet.account?.ownerUserId ?? null]));
  const staffed = new Set<string>(homes.map((row) => row.organizationId));
  for (const member of members) {
    if (member.userId !== ownerOf.get(member.organizationId)) staffed.add(member.organizationId);
  }
  return cabinets.map((cabinet) => ({
    accountId: cabinet.accountId,
    serviceCode: cabinet.serviceCode,
    linkedServiceCode: cabinet.linkedServiceCode,
    staffed: staffed.has(cabinet.id),
  }));
}

/** Места кабинетов по организациям (только те, где мест больше нуля). */
export async function masterCabinetSeatsByOrg(orgIds: string[]): Promise<Map<string, number>> {
  if (orgIds.length === 0) return new Map();
  const orgs = await db.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, accountId: true, serviceCode: true, linkedServiceCode: true },
  });
  const accountIds = [...new Set(orgs.map((org) => org.accountId).filter((id): id is string => Boolean(id)))];
  return masterCabinetSeatsPerOrg(orgs, await loadCabinets(accountIds));
}

/**
 * Сколько мест добавит кабинету первый человек с доступом: у кабинета ещё
 * нет людей — по месту на каждую подключённую организацию аккаунта, иначе 0.
 */
export async function masterCabinetSeatsToAdd(cabinetId: string): Promise<number> {
  const cabinet = await db.organization.findUnique({
    where: { id: cabinetId },
    select: { accountId: true, serviceCode: true, linkedServiceCode: true },
  });
  const code = poolCodeOf(cabinet);
  if (!cabinet?.accountId || !code) return 0;
  const [current] = (await loadCabinets([cabinet.accountId])).filter(
    (item) => poolCodeOf(item) === code && item.staffed
  );
  if (current) return 0;
  return db.organization.count({
    where: {
      accountId: cabinet.accountId,
      isDemo: false,
      kind: { not: "directory" },
      OR: [{ linkedServiceCode: code }, { serviceCode: code, linkedServiceCode: null }],
    },
  });
}

/** Организация аккаунта, подключённая к кабинету, — на её тарифе проверяются места кабинета. */
export async function connectedSeatOrganization(cabinetId: string): Promise<string | null> {
  const cabinet = await db.organization.findUnique({
    where: { id: cabinetId },
    select: { accountId: true, serviceCode: true, linkedServiceCode: true },
  });
  const code = poolCodeOf(cabinet);
  if (!cabinet?.accountId || !code) return null;
  const org = await db.organization.findFirst({
    where: {
      accountId: cabinet.accountId,
      isDemo: false,
      kind: { not: "directory" },
      OR: [{ linkedServiceCode: code }, { serviceCode: code, linkedServiceCode: null }],
    },
    select: { id: true },
  });
  return org?.id ?? null;
}
