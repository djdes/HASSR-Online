import { db } from "@/lib/db";

/**
 * Ответственный менеджер клиента (`Organization.accountManagerId`): менеджер с
 * охватом «свои» видит в панели только закреплённых за ним клиентов. При
 * назначении лиды CRM этой организации без ответственного или у прежнего
 * менеджера переходят новому — переписка с клиентом остаётся у того, кто его ведёт.
 */

export class AccountManagerError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type AccountManagerOption = { id: string; name: string; roleTitle: string | null };

/** Кого можно закрепить: владелец платформы и все, у кого есть раздел «Клиенты». */
export async function listAccountManagerOptions(): Promise<AccountManagerOption[]> {
  const users = await db.user.findMany({
    where: { isActive: true, archivedAt: null, OR: [{ isRoot: true }, { platformSections: { has: "clients" } }] },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, isRoot: true, platformRole: { select: { title: true } } },
  });
  return users.map((user) => ({ id: user.id, name: user.name, roleTitle: user.isRoot ? "Владелец" : (user.platformRole?.title ?? null) }));
}

/** Клиенты, закреплённые за менеджером (список «Клиенты» для охвата «свои»). */
export async function assignedOrganizationIds(userId: string): Promise<Set<string>> {
  const rows = await db.organization.findMany({ where: { accountManagerId: userId }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}

/** Шапка карточки клиента: кто закреплён и кого можно выбрать (если можно менять). */
export async function loadAccountManagerView(
  accountManagerId: string | null | undefined,
  withOptions: boolean,
): Promise<{ current: { id: string; name: string } | null; options: AccountManagerOption[] }> {
  const [current, options] = await Promise.all([
    accountManagerId ? db.user.findUnique({ where: { id: accountManagerId }, select: { id: true, name: true } }) : Promise.resolve(null),
    withOptions ? listAccountManagerOptions() : Promise.resolve([]),
  ]);
  return { current, options };
}

export async function setAccountManager(
  actor: { id: string; name: string | null; organizationId: string },
  organizationId: string,
  managerId: string | null,
): Promise<{ manager: { id: string; name: string } | null; movedLeads: number }> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, accountManagerId: true } });
  if (!org) throw new AccountManagerError("Организация не найдена", 404);
  let manager: { id: string; name: string } | null = null;
  if (managerId) {
    manager = await db.user.findFirst({
      where: { id: managerId, isActive: true, archivedAt: null, OR: [{ isRoot: true }, { platformSections: { has: "clients" } }] },
      select: { id: true, name: true },
    });
    if (!manager) throw new AccountManagerError("Закрепить можно только сотрудника с разделом «Клиенты»");
  }
  const previous = org.accountManagerId;
  let movedLeads = 0;
  await db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: organizationId }, data: { accountManagerId: managerId } });
    if (managerId) {
      const moved = await tx.crmContact.updateMany({
        where: { organizationId, OR: [{ ownerId: null }, ...(previous && previous !== managerId ? [{ ownerId: previous }] : [])] },
        data: { ownerId: managerId },
      });
      movedLeads = moved.count;
      // Открытые сделки и задачи CRM этого клиента — новому менеджеру.
      const prior = { OR: [{ ownerId: null }, ...(previous && previous !== managerId ? [{ ownerId: previous }] : [])] };
      await tx.crmDeal.updateMany({ where: { organizationId, stage: { notIn: ["won", "lost"] }, ...prior }, data: { ownerId: managerId } });
      await tx.crmTask.updateMany({
        where: { organizationId, status: "open", kind: { not: "approval" }, OR: [{ assigneeId: null }, ...(previous && previous !== managerId ? [{ assigneeId: previous }] : [])] },
        data: { assigneeId: managerId, notifiedAt: null },
      });
    }
  });
  await db.auditLog
    .create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        userName: actor.name,
        action: "organization.account_manager",
        entity: "organization",
        entityId: organizationId,
        details: { organization: org.name, before: previous, after: managerId, movedLeads },
      },
    })
    .catch((error) => console.error("[account-manager] audit failed", error));
  return { manager, movedLeads };
}
