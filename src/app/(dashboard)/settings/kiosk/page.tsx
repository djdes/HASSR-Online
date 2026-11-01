import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { isPointScoped } from "@/lib/point-scope";
import { getViewedPointId } from "@/lib/active-building";
import { visibleStaffWhere } from "@/lib/people-scope.server";

import { KioskClient, type KioskDeviceRow, type KioskEmployeeRow } from "./kiosk-client";

export const dynamic = "force-dynamic";

/**
 * Общий планшет: руководитель привязывает планшеты и выдаёт сотрудникам
 * 4-значные ПИН. На планшете сотрудник выбирает себя, вводит ПИН и
 * подписывает записи в журналах своим именем.
 */
export default async function KioskSettingsPage() {
  const t = await getTranslations("settingsUi.kioskPage");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const orgId = getActiveOrgId(session);
  // Точка в шапке (аудит 2026-11-01): планшеты точки и общие, люди точки —
  // у руководства с выбранной точкой тоже, не только у руководителя точки.
  const viewedPoint = await getViewedPointId(session);

  const [org, devices, employees] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: { kioskEnabled: true, kioskIdleLockSeconds: true, kioskPhotoRequired: true },
    }),
    // Руководитель точки видит планшеты и людей только своих точек (аудит точек, 2026-11-01).
    db.kioskDevice.findMany({
      where: {
        organizationId: orgId,
        revokedAt: null,
        ...(isPointScoped(session.user) ? { buildingId: { in: session.user.pointScope ?? [] } } : {}),
        ...(viewedPoint ? { OR: [{ buildingId: viewedPoint }, { buildingId: null }] } : {}),
      },
      select: { id: true, label: true, lastSeenAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.user.findMany({
      // Оба условия занимают `AND` — объединяем, а не перезаписываем.
      where: { organizationId: orgId, AND: [ORG_ROSTER_WHERE, await visibleStaffWhere(session)] },
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
        title={t("title")}
        description={t("description")}
        actions={<PageHeaderStat tone={withoutPin > 0 ? "warn" : "ok"}>{withoutPin > 0 ? t("withoutPin", { count: withoutPin }) : t("allHavePin")}</PageHeaderStat>}
      />
      <KioskClient
        idleLockSeconds={org?.kioskIdleLockSeconds ?? 90}
        photoRequired={org?.kioskPhotoRequired ?? false}
        devices={deviceRows}
        employees={employeeRows}
      />
    </div>
  );
}
