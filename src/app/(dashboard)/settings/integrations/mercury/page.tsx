import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuth } from "@/lib/auth-helpers";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasPlanFeature } from "@/lib/billing.server";
import { resolveTransportMode } from "@/lib/mercury/transport";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

import { MercurySettingsClient } from "./mercury-settings-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Настройки ФГИС «Меркурий».
 *
 * Страница копирует форму `settings/integrations/tasksflow`, но с одним
 * принципиальным отличием: здесь НЕТ поля «API-ключ». APIKey выдаётся
 * один на информационную систему — то есть на весь WeSetup — и живёт в
 * env. От клиента нужны ГУИД его хозяйствующего субъекта и логин
 * уполномоченного лица, от чьего имени будут гаситься ВСД.
 */
export default async function MercurySettingsPage() {
  const t = await getTranslations("settingsUi.mercuryPage");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");

  const organizationId = getActiveOrgId(session);
  const [org, integration, buildings, users] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { inn: true, name: true },
    }),
    db.mercuryIntegration.findUnique({
      where: { organizationId },
      select: {
        environment: true,
        issuerGuid: true,
        initiatorLogin: true,
        enabled: true,
        autoProcessMode: true,
        autoSupplierInns: true,
        notifyUserId: true,
        lastSyncAt: true,
        lastSyncError: true,
        label: true,
        // apiKeyEncrypted НЕ выбираем никогда — как в tasksflow-странице.
        enterprises: {
          select: {
            id: true,
            enterpriseGuid: true,
            activityLocationGuid: true,
            name: true,
            address: true,
            enabled: true,
            buildingId: true,
          },
          orderBy: { name: "asc" },
        },
        _count: { select: { documents: true, outbox: true } },
      },
    }),
    db.building.findMany({
      where: { organizationId },
      select: { id: true, name: true, address: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
  ]);

  // «Меркурий» — возможность «Премиума» (и пробного, прежней «Подписки», демо).
  const available = await hasPlanFeature(organizationId, "mercury");
  const mode = resolveTransportMode({});

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
      />

      <PageGuide
        title={t("guideTitle")}
        storageKey="settings-mercury-v1"
        bullets={[
          {
            title: t("b1Title"),
            body: t("b1Body"),
          },
          {
            title: t("b2Title"),
            body: t("b2Body"),
          },
          {
            title: t("b3Title"),
            body: t("b3Body"),
          },
          {
            title: t("b4Title"),
            body: t("b4Body"),
          },
        ]}
        qa={[
          {
            q: t("q1"),
            a: t("a1"),
          },
          {
            q: t("q2"),
            a: t("a2"),
          },
          {
            q: t("q3"),
            a: t("a3"),
          },
        ]}
      />

      <MercurySettingsClient
        available={available}
        mode={mode}
        orgName={org?.name ?? ""}
        orgInn={org?.inn ?? null}
        integration={
          integration
            ? {
                environment: integration.environment,
                issuerGuid: integration.issuerGuid,
                initiatorLogin: integration.initiatorLogin,
                enabled: integration.enabled,
                autoProcessMode: integration.autoProcessMode,
                autoSupplierInns: Array.isArray(integration.autoSupplierInns)
                  ? (integration.autoSupplierInns as string[])
                  : [],
                notifyUserId: integration.notifyUserId,
                lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
                lastSyncError: integration.lastSyncError,
                label: integration.label,
                enterprises: integration.enterprises,
                documentsCount: integration._count.documents,
                queueCount: integration._count.outbox,
              }
            : null
        }
        buildings={buildings}
        users={users.map((u) => ({ id: u.id, name: u.name ?? t("unnamed") }))}
      />
    </div>
  );
}
