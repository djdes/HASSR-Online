import { forbidden } from "next/navigation";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { loadControlGroup } from "@/lib/control-group.server";
import { hasCapability } from "@/lib/permission-presets";
import { sessionHasPermission } from "@/lib/permissions-server";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { ControlGroupClient } from "@/components/staff/control-group-client";

export const dynamic = "force-dynamic";

/**
 * «Контроль-группа» (решение владельца, план 4.2 и раздел 7): люди с набором
 * прав `control_group` — видят всё, подтверждают выполненное, назначают
 * задачи в пределах «Иерархии», сами не заполняют. Список — та же функция,
 * что у `GET /api/staff/control-group`; добавить и убрать —
 * `POST /api/staff/[id]/preset`.
 */
export default async function ControlGroupPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // Набор прав меняет администратор (как API); «Иерархию» открывает право из БД.
  const canManage = hasCapability(session.user, "admin.full");
  const canNarrow = await sessionHasPermission(session, "settings.permissions");
  const { members, candidates } = await loadControlGroup(organizationId, session.user.id);

  return (
    <DomainMessagesBoundary namespaces={["staffPages", "staffManagement", "productionControl"]}>
      <ControlGroupClient members={members} candidates={candidates} canManage={canManage} canNarrow={canNarrow} />
    </DomainMessagesBoundary>
  );
}
