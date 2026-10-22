import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { TaskVisibilityClient } from "@/components/settings/task-visibility-client";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function TaskVisibilityPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "settingsTaskVisibility" });

  const positions = await db.jobPosition.findMany({
    where: { organizationId },
    orderBy: [
      { categoryKey: "asc" },
      { sortOrder: "asc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      categoryKey: true,
      seesAllTasks: true,
      _count: {
        select: { users: { where: { isActive: true, archivedAt: null } } },
      },
    },
  });

  return (
    <DomainMessagesBoundary namespaces={["settingsTaskVisibility"]}>
    <div className="space-y-5">
      {/* Тёмный hero снят: ниже уже идут PageGuide с подробностями и сам
          список должностей — баннер только отодвигал их вниз. */}
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <PageGuide
        storageKey="task-visibility"
        title={t("guide.title")}
        bullets={[
          {
            title: t("guide.default.title"),
            body: t("guide.default.body"),
          },
          {
            title: t("guide.choose.title"),
            body: t("guide.choose.body"),
          },
          {
            title: t("guide.managers.title"),
            body: t("guide.managers.body", { hierarchyPath: "/settings/staff-hierarchy" }),
          },
          {
            title: t("guide.sync.title"),
            body: t("guide.sync.body", { integrationPath: "/settings/integrations/tasksflow" }),
          },
        ]}
        qa={[
          {
            q: t("guide.removed.question"),
            a: t("guide.removed.answer"),
          },
          {
            q: t("guide.empty.question"),
            a: t("guide.empty.answer"),
          },
        ]}
      />

      <TaskVisibilityClient
        positions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          categoryKey: p.categoryKey,
          seesAllTasks: p.seesAllTasks,
          activeUsers: p._count.users,
        }))}
      />
    </div>
    </DomainMessagesBoundary>
  );
}
