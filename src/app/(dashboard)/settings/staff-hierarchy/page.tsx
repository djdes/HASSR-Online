import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Network } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { sessionHasPermission } from "@/lib/permissions-server";
import { StaffHierarchyClient } from "@/components/settings/staff-hierarchy-client";
import { PageGuide } from "@/components/ui/page-guide";
import { sortJournalsByName } from "@/lib/journal-sort";

export const dynamic = "force-dynamic";

export default async function StaffHierarchyPage() {
  const t = await getTranslations("settingsUi.staffHierarchyPage");
  const session = await requireAuth();
  const hasAccess = await sessionHasPermission(session, "settings.permissions");
  if (!hasAccess) {
    forbidden();
  }

  const orgId = getActiveOrgId(session);

  const [positions, employees, scopes, templates] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId: orgId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, categoryKey: true },
    }),
    db.user.findMany({
      where: { organizationId: orgId, archivedAt: null, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        jobPositionId: true,
        positionTitle: true,
        role: true,
      },
    }),
    db.managerScope.findMany({
      where: { organizationId: orgId },
      include: {
        manager: {
          select: { id: true, name: true, jobPositionId: true, positionTitle: true },
        },
      },
    }),
    db.journalTemplate.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-3 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#fff8eb]">
            <Network className="size-5 text-[#f59e0b]" />
          </div>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold text-[#0b1024]">
              {t("title")}
            </h1>
            <p className="text-[13px] text-[#6f7282]">
              {t("subtitle")}
            </p>
          </div>
        </div>
      </div>

      <PageGuide
        storageKey="staff-hierarchy"
        title={t("guideTitle")}
        bullets={[
          {
            title: t("bullet1Title"),
            body: t("bullet1Body"),
          },
          {
            title: t("bullet2Title"),
            body: t("bullet2Body"),
          },
          {
            title: t("bullet3Title"),
            body: t("bullet3Body"),
          },
        ]}
        qa={[
          {
            q: t("qa1q"),
            a: t("qa1a"),
          },
          {
            q: t("qa2q"),
            a: t("qa2a"),
          },
        ]}
      />

      <StaffHierarchyClient
        positions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          categoryKey: p.categoryKey as "management" | "staff",
        }))}
        employees={employees.map((u) => ({
          id: u.id,
          name: u.name,
          jobPositionId: u.jobPositionId,
          positionTitle: u.positionTitle,
        }))}
        scopes={scopes.map((s) => ({
          id: s.id,
          managerId: s.managerId,
          managerName: s.manager.name,
          managerPosition: s.manager.positionTitle,
          viewMode: s.viewMode as "all" | "job_positions" | "specific_users" | "none",
          viewJobPositionIds: s.viewJobPositionIds,
          viewUserIds: s.viewUserIds,
          assignableJournalCodes: s.assignableJournalCodes,
        }))}
        journals={sortJournalsByName(templates, (t) => t.name).map((t) => ({
          code: t.code,
          name: t.name,
        }))}
      />
    </div>
  );
}
