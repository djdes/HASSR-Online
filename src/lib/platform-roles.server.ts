import { db } from "@/lib/db";
import { normalizePlatformScope, normalizePlatformSections } from "@/lib/platform-access";
import { BUILTIN_ROLES, roleKeyFrom, validateRoleShape, type RoleInput, type RoleView } from "@/lib/platform-roles";
import { TeamError, type PlatformActor } from "@/lib/platform-team.server";

/**
 * Роли панели: список, создание, изменение, удаление. Разделы и флаг РОП
 * роли копируются её людям — проверки доступа читают `platformSections` и
 * `platformSalesHead`, как раньше; изменение роли сразу меняет доступ всех.
 */

type RoleRow = Awaited<ReturnType<typeof db.platformRole.findMany>>[number] & { _count?: { users: number } };

function toView(row: RoleRow): RoleView {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    sections: normalizePlatformSections(row.sections),
    scope: normalizePlatformScope(row.scope),
    salesHead: row.salesHead,
    signatureTitle: row.signatureTitle,
    discountLimit: row.discountLimit ?? 0,
    system: row.system,
    members: row._count?.users ?? 0,
  };
}

export async function listPlatformRoles(): Promise<RoleView[]> {
  const rows = await db.platformRole.findMany({
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { users: { where: { archivedAt: null } } } } },
  });
  return rows.map(toView);
}

/**
 * Лимиты скидки встроенных ролей, созданных до появления лимита (колонка
 * пустая): коммерческий директор 25 %, РОП 15 %, менеджер 10 %. Заданное
 * владельцем не трогаем. Возвращает число обновлённых ролей.
 */
export async function fillBuiltinDiscountLimits(): Promise<number> {
  let updated = 0;
  for (const role of BUILTIN_ROLES) {
    const result = await db.platformRole.updateMany({ where: { key: role.key, discountLimit: null }, data: { discountLimit: role.discountLimit } });
    updated += result.count;
  }
  return updated;
}

/** Встроенные роли — создать недостающие (правки владельца не трогаем). */
export async function ensureBuiltinRoles(): Promise<number> {
  let created = 0;
  for (const role of BUILTIN_ROLES) {
    const exists = await db.platformRole.findUnique({ where: { key: role.key }, select: { id: true } });
    if (exists) continue;
    await db.platformRole.create({
      data: {
        key: role.key,
        title: role.title,
        description: role.description,
        sections: [...role.sections],
        scope: role.scope,
        salesHead: role.salesHead,
        signatureTitle: role.signatureTitle,
        discountLimit: role.discountLimit,
        sort: role.sort,
        system: true,
      },
    });
    created += 1;
  }
  return created;
}

function cleanInput(input: RoleInput) {
  const error = validateRoleShape(input);
  if (error) throw new TeamError(error);
  return {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    sections: normalizePlatformSections(input.sections),
    scope: input.scope,
    salesHead: input.salesHead,
    signatureTitle: input.signatureTitle?.trim() || null,
    discountLimit: input.discountLimit ?? 0,
  };
}

async function audit(actor: PlatformActor, action: string, entityId: string, details: Record<string, unknown>) {
  await db.auditLog
    .create({ data: { organizationId: actor.user.organizationId, userId: actor.user.id, userName: actor.user.name ?? null, action, entity: "platformRole", entityId, details: details as object } })
    .catch((error) => console.error("[platform-roles] audit failed", error));
}

export async function createPlatformRole(actor: PlatformActor, input: RoleInput): Promise<RoleView> {
  const data = cleanInput(input);
  const last = await db.platformRole.findFirst({ orderBy: { sort: "desc" }, select: { sort: true } });
  const row = await db.platformRole.create({
    data: { ...data, key: roleKeyFrom(data.title), sort: (last?.sort ?? 0) + 10, system: false },
    include: { _count: { select: { users: true } } },
  });
  await audit(actor, "platform.role.create", row.id, { title: row.title, sections: row.sections, scope: row.scope, salesHead: row.salesHead });
  return toView(row);
}

/** Изменение роли: её люди сразу получают новые разделы и флаг РОП. */
export async function updatePlatformRole(actor: PlatformActor, id: string, input: RoleInput): Promise<RoleView> {
  const existing = await db.platformRole.findUnique({ where: { id } });
  if (!existing) throw new TeamError("Роль не найдена", 404);
  const data = cleanInput(input);
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.platformRole.update({ where: { id }, data, include: { _count: { select: { users: true } } } });
    await tx.user.updateMany({
      where: { platformRoleId: id, isRoot: false },
      data: { platformSections: data.sections, platformSalesHead: data.salesHead },
    });
    return updated;
  });
  await audit(actor, "platform.role.update", id, {
    before: { title: existing.title, sections: existing.sections, scope: existing.scope, salesHead: existing.salesHead },
    after: data,
  });
  return toView(row);
}

export async function deletePlatformRole(actor: PlatformActor, id: string): Promise<void> {
  const role = await db.platformRole.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) return;
  if (role.system) throw new TeamError("Встроенную роль удалить нельзя — её можно изменить");
  if (role._count.users > 0) throw new TeamError("У роли есть люди — сначала назначьте им другую роль");
  await db.platformRole.delete({ where: { id } });
  await audit(actor, "platform.role.delete", id, { title: role.title });
}
