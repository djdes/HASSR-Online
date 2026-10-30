import { forbidden, redirect } from "next/navigation";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { MasterCabinetClient } from "@/components/settings/master-cabinet-client";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { listAccountCabinetsAccess } from "@/lib/master-cabinet-access";
import { MASTER_ORG_KIND } from "@/lib/master-directory";
import { loadOrgMasterCabinets } from "@/lib/org-master-cabinets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

/**
 * Мастер-кабинеты справочников организации (скан 99 от 2026-10-28): какие
 * кабинеты есть, какие точки к ним подключены, операторы; «Добавить точку»
 * и приглашение оператора — прямо здесь. Только полный доступ (как «Общий
 * справочник блюд»); руководителю точки закрыто, как вся «Моя компания».
 */
export default async function MasterCabinetSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const orgId = getActiveOrgId(session);

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
  if (org?.kind === MASTER_ORG_KIND) redirect("/master");

  const view = await loadOrgMasterCabinets(orgId, session.user.id);
  // Людьми кабинетов аккаунта управляет его владелец — тот же блок, что в «Правах доступа».
  const access = view.viewerIsOwner ? await listAccountCabinetsAccess(session.user.id).catch(() => null) : null;

  return (
    <DomainMessagesBoundary namespaces={["masterCabinetUi"]}>
      <MasterCabinetClient initialView={view} initialAccess={access} />
    </DomainMessagesBoundary>
  );
}
