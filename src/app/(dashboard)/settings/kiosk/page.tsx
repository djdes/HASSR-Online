import { redirect } from "next/navigation";

import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";

import { KioskClient, type KioskDeviceRow, type KioskEmployeeRow } from "./kiosk-client";

export const dynamic = "force-dynamic";

/**
 * Общий планшет: руководитель привязывает планшеты и выдаёт сотрудникам
 * 4-значные ПИН. На планшете сотрудник выбирает себя, вводит ПИН и
 * подписывает записи в журналах своим именем.
 */
export default async function KioskSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const orgId = getActiveOrgId(session);

  const [org, devices, employees] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: { kioskEnabled: true, kioskIdleLockSeconds: true },
    }),
    db.kioskDevice.findMany({
      where: { organizationId: orgId, revokedAt: null },
      select: { id: true, label: true, lastSeenAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.user.findMany({
      where: { organizationId: orgId, ...ORG_ROSTER_WHERE },
      select: { id: true, name: true, positionTitle: true, qrPinHash: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const deviceRows: KioskDeviceRow[] = devices.map((d) => ({
    id: d.id,
    label: d.label,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
  }));
  const employeeRows: KioskEmployeeRow[] = employees.map((e) => ({
    id: e.id,
    name: e.name,
    positionTitle: e.positionTitle,
    hasPin: Boolean(e.qrPinHash),
  }));
  const withoutPin = employeeRows.filter((e) => !e.hasPin).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Общий планшет"
        description="Один планшет на кухне или складе: каждый сотрудник подписывает записи своим 4-значным ПИН, никто не путается в чужих именах."
        actions={<PageHeaderStat tone={withoutPin > 0 ? "warn" : "ok"}>{withoutPin > 0 ? `Без ПИН: ${withoutPin}` : "У всех есть ПИН"}</PageHeaderStat>}
      />
      <KioskClient
        idleLockSeconds={org?.kioskIdleLockSeconds ?? 90}
        devices={deviceRows}
        employees={employeeRows}
      />
    </div>
  );
}
