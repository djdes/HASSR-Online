import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { TasksFlowSettingsClient } from "./tasksflow-settings-client";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

export default async function TasksFlowSettingsPage() {
  const t = await getTranslations("settingsUi.tasksflowPage");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    forbidden();
  }
  const orgId = getActiveOrgId(session);

  const integration = await db.tasksFlowIntegration.findUnique({
    where: { organizationId: orgId },
    select: {
      id: true,
      baseUrl: true,
      apiKeyPrefix: true,
      tasksflowCompanyId: true,
      enabled: true,
      lastSyncAt: true,
      label: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { links: true, taskLinks: true } },
    },
  });

  return (
    <div className="space-y-5">
      <PageGuide
        title={t("guideTitle")}
        storageKey="settings-tasksflow-v1"
        bullets={[
          { title: t("b1Title"), body: t("b1Body") },
          { title: t("b2Title"), body: t("b2Body") },
          { title: t("b3Title"), body: t("b3Body") },
        ]}
        qa={[
          { q: t("q1"), a: t("a1") },
          { q: t("q2"), a: t("a2") },
        ]}
      />
      <TasksFlowSettingsClient
      organizationName={session.user.organizationName ?? ""}
      initialIntegration={
        integration
          ? {
              id: integration.id,
              baseUrl: integration.baseUrl,
              apiKeyPrefix: integration.apiKeyPrefix,
              tasksflowCompanyId: integration.tasksflowCompanyId,
              enabled: integration.enabled,
              lastSyncAt: integration.lastSyncAt
                ? integration.lastSyncAt.toISOString()
                : null,
              label: integration.label,
              linkedUserCount: integration._count.links,
              taskLinkCount: integration._count.taskLinks,
            }
          : null
      }
    />
    </div>
  );
}
