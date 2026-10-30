import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

import { WebhooksClient } from "./webhooks-client";
import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export const dynamic = "force-dynamic";

/** Исходящие вебхуки: подписки на события, подпись, повторы, журнал доставок. */
export default async function WebhooksSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const t = await getTranslations("webhooksSettings");
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <DomainMessagesBoundary namespaces={["webhooksSettings"]}><WebhooksClient /></DomainMessagesBoundary>
    </div>
  );
}
