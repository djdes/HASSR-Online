import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { PageHeader } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { readDepartmentPointMap, readDepartments } from "@/lib/hr1c/points";
import { decryptSecret } from "@/lib/integration-crypto";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

import { Hr1cSettingsClient } from "./hr1c-settings-client";

export const dynamic = "force-dynamic";

/**
 * «1С: кадры» — синхронизация сотрудников с 1С:ЗУП: по опубликованной базе
 * (OData) или из обработки 1С через API. Пароль OData не показывается.
 */
export default async function Hr1cSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const [t, organization, connection, positions, targets] = await Promise.all([
    getTranslations("hr1c"),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.hrConnection.findUnique({ where: { organizationId } }),
    db.jobPosition.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    buildingTargets(organizationId),
  ]);
  // Подразделения 1С → точки (2026-10-31): только при включённых точках.
  const pointIds = targets.filter((id): id is string => id !== null);
  const points = pointIds.length > 0
    ? await db.building.findMany({ where: { id: { in: pointIds } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } })
    : [];
  const departments = readDepartments(connection?.departmentsJson);
  const departmentMap = readDepartmentPointMap(connection?.departmentPointsJson, new Set(pointIds));
  const base = (process.env.NEXTAUTH_URL ?? "https://wesetup.ru").replace(/\/+$/, "");
  // Логин не секрет — показываем, чтобы не вводить заново; пароль — нет.
  let login = "";
  if (connection?.credentialsEnc) {
    try {
      login = (JSON.parse(decryptSecret(connection.credentialsEnc)) as { login?: string }).login ?? "";
    } catch {
      login = "";
    }
  }
  const lastResult = connection?.lastResult && typeof connection.lastResult === "object" ? (connection.lastResult as Record<string, number>) : null;

  return (
    <DomainMessagesBoundary namespaces={["hr1c"]}>
      <div className="space-y-5">
        <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
        <Hr1cSettingsClient
          initial={{
            connected: connection !== null,
            odataUrl: connection?.odataUrl ?? "",
            login,
            hasPassword: Boolean(connection?.credentialsEnc),
            defaultPositionId: connection?.defaultPositionId ?? "",
            autoApply: connection?.autoApply ?? false,
            lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
            lastError: connection?.lastError ?? null,
            lastResult: lastResult
              ? { hire: lastResult.hire ?? 0, dismiss: lastResult.dismiss ?? 0, update: lastResult.update ?? 0, link: lastResult.link ?? 0 }
              : null,
          }}
          positions={positions}
          points={points}
          departments={departments}
          departmentMap={departmentMap}
          apiUrl={`${base}/api/external/hr/employees`}
          timeZone={organization?.timezone || "Europe/Moscow"}
        />
      </div>
    </DomainMessagesBoundary>
  );
}
