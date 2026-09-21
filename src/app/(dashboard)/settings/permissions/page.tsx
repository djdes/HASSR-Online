import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { sessionHasPermission } from "@/lib/permissions-server";
import {
  DEFAULT_MANAGEMENT_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  PERMISSION_GROUPS,
  sanitizePermissionsJson,
  type Permission,
} from "@/lib/permissions";
import { PermissionsEditor } from "@/components/settings/permissions-editor";

export const dynamic = "force-dynamic";

export default async function PermissionsSettingsPage() {
  const session = await requireAuth();
  const hasAccess = await sessionHasPermission(session, "settings.permissions");
  if (!hasAccess) {
    redirect("/settings");
  }

  const organizationId = getActiveOrgId(session);

  const [positions, users] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        categoryKey: true,
        permissionsJson: true,
        _count: { select: { users: true } },
      },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
        permissionsJson: true,
        jobPositionId: true,
        jobPosition: {
          select: { id: true, name: true, categoryKey: true },
        },
      },
    }),
  ]);

  const positionItems = positions.map((p) => ({
    id: p.id,
    name: p.name,
    // «Комиссия» (сторонние члены бракеражной комиссии) — не руководство.
    categoryKey: (p.categoryKey === "management" ? "management" : "staff") as
      | "management"
      | "staff",
    permissions: readPermissions(p.permissionsJson),
    memberCount: p._count.users,
  }));

  const userItems = users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    jobPositionId: u.jobPositionId,
    positionName: u.jobPosition?.name ?? null,
    positionCategory: u.jobPosition?.categoryKey ?? null,
    permissions: readPermissions(u.permissionsJson),
  }));

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              Права доступа
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              Три уровня настройки: базовый пакет для{" "}
              <strong className="text-[#0b1024]">группы</strong> (Руководство
              / Сотрудники), особые права для{" "}
              <strong className="text-[#0b1024]">должности</strong> и, при
              необходимости, индивидуально на{" "}
              <strong className="text-[#0b1024]">конкретном человеке</strong>.
              Более низкий уровень переопределяет более высокий.
            </p>
          </div>
        </div>
      </div>

      <PermissionsEditor
        groups={[...PERMISSION_GROUPS]}
        positions={positionItems}
        users={userItems}
        managementDefaults={[...DEFAULT_MANAGEMENT_PERMISSIONS]}
        staffDefaults={[...DEFAULT_STAFF_PERMISSIONS]}
      />
    </div>
  );
}

function readPermissions(value: unknown): Permission[] | null {
  if (value === null || value === undefined) return null;
  return sanitizePermissionsJson(value);
}
