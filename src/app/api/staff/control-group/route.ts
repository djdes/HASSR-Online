import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { describeManagerScope } from "@/lib/control-group";
import { db } from "@/lib/db";
import { JOURNAL_ACCESS_CATALOG } from "@/lib/journal-access-catalog";
import type { ManagerScope } from "@/lib/manager-scope";
import { effectivePreset, hasCapability, isValidPreset } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/control-group — участники контроль-группы и кандидаты.
 *
 *   members[]    — сотрудники с пресетом `control_group`: должность и кратко
 *                  их «Иерархия» (`ManagerScope`: кого видят, задачи каких
 *                  журналов назначают; `scope.sees` / `scope.assigns` —
 *                  готовые строки, остальное — для своей вёрстки);
 *   candidates[] — кого можно «Добавить»: активные сотрудники организации
 *                  вне контроль-группы, кроме себя (себе набор без
 *                  «Администратора» не поставить — см. staff-preset-change).
 *
 * Добавить / убрать — `POST /api/staff/[id]/preset` с `control_group` / null
 * (`canManage` — может ли текущий пользователь это делать).
 * Доступ: руководитель (как у «Иерархии»).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  const [users, positions, scopes] = await Promise.all([
    db.user.findMany({
      where: { organizationId, archivedAt: null, isActive: true, isRoot: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        permissionPreset: true,
        positionTitle: true,
        jobPositionId: true,
        jobPosition: { select: { name: true } },
      },
    }),
    db.jobPosition.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.managerScope.findMany({ where: { organizationId } }),
  ]);

  const lookup = {
    positions: new Map(positions.map((position) => [position.id, position.name])),
    users: new Map(users.map((user) => [user.id, user.name])),
    journals: new Map<string, string>(JOURNAL_ACCESS_CATALOG.map((item) => [item.code, item.name])),
  };
  const scopeByManager = new Map(scopes.map((scope) => [scope.managerId, scope]));
  const positionOf = (user: (typeof users)[number]) =>
    user.jobPosition?.name?.trim() || user.positionTitle?.trim() || "";

  const members = users
    .filter((user) => user.permissionPreset === "control_group")
    .map((user) => {
      const row = scopeByManager.get(user.id);
      const scope: ManagerScope | null = row
        ? {
            id: row.id,
            managerId: row.managerId,
            viewMode: (["all", "job_positions", "specific_users", "none"].includes(row.viewMode)
              ? row.viewMode
              : "all") as ManagerScope["viewMode"],
            viewJobPositionIds: row.viewJobPositionIds,
            viewUserIds: row.viewUserIds,
            assignableJournalCodes: row.assignableJournalCodes,
          }
        : null;
      return {
        id: user.id,
        name: user.name,
        position: positionOf(user),
        role: user.role,
        scopeId: row?.id ?? null,
        scope: describeManagerScope(scope, lookup),
      };
    });

  const candidates = users
    .filter((user) => user.permissionPreset !== "control_group" && user.id !== session.user.id)
    .map((user) => ({
      id: user.id,
      name: user.name,
      position: positionOf(user),
      permissionPreset: user.permissionPreset && isValidPreset(user.permissionPreset) ? user.permissionPreset : null,
      effectivePreset: effectivePreset(user),
    }));

  return NextResponse.json({
    members,
    candidates,
    canManage: hasCapability(session.user, "admin.full"),
  });
}
