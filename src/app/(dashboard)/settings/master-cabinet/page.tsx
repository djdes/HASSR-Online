import { redirect } from "next/navigation";

import { MasterCabinetClient } from "@/components/settings/master-cabinet-client";
import { PageHeader } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getMasterCabinetStatus } from "@/lib/master-cabinet";
import { MASTER_ORG_KIND } from "@/lib/master-directory";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

/**
 * Мастер-кабинет справочников — настройка у пищеблока: код пула,
 * подключённые объекты, создание кабинета и приглашение сотрудника
 * бэк-офиса. Только полный доступ (как «Общий справочник блюд»).
 */
export default async function MasterCabinetSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const orgId = getActiveOrgId(session);

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { name: true, kind: true, isDemo: true },
  });
  if (org?.kind === MASTER_ORG_KIND) redirect("/master");

  const status = await getMasterCabinetStatus(orgId, session.user.id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Мастер-кабинет справочников"
        description="Меню и сырьё загружает один человек в бэк-офисе — все объекты с вашим кодом получают их в журналы бракеража и скоропорта."
      />
      <MasterCabinetClient
        initialStatus={status}
        organizationName={org?.name ?? ""}
        isDemo={Boolean(org?.isDemo)}
      />
    </div>
  );
}
