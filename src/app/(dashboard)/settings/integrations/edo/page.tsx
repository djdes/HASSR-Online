import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { PageHeader } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integration-crypto";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { connectionView, type SupplyConnectionView } from "@/lib/supply/connections";

import { EdoSettingsClient } from "./edo-settings-client";

export const dynamic = "force-dynamic";

/**
 * Подключение ЭДО для входящих накладных: Диадок и СБИС. Ключи — только
 * зашифрованными; страница показывает маску (логин, ящик), не секреты.
 */
export default async function EdoSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const [t, organization, rows] = await Promise.all([
    getTranslations("supplyEdo.settings"),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.supplyConnection.findMany({ where: { organizationId } }),
  ]);
  const views: Partial<Record<"diadoc" | "saby", SupplyConnectionView>> = {};
  for (const row of rows) {
    if (row.provider !== "diadoc" && row.provider !== "saby") continue;
    let credentials: unknown = null;
    try {
      credentials = JSON.parse(decryptSecret(row.credentialsEnc));
    } catch {
      credentials = null;
    }
    views[row.provider] = connectionView(row.provider, credentials, row);
  }

  return (
    <DomainMessagesBoundary namespaces={["supplyEdo"]}>
      <div className="space-y-5">
        <PageHeader
          eyebrow={t("eyebrow")}
          title={t("title")}
          description={t("description")}
          actions={
            <Link
              href="/edo"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              {t("open")}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        />
        <EdoSettingsClient
          diadoc={views.diadoc ?? null}
          saby={views.saby ?? null}
          timeZone={organization?.timezone || "Europe/Moscow"}
        />
        <p className="text-[13px] leading-relaxed text-[#6f7282]">
          {t("secretsNote")} {t("schedule")}
        </p>
      </div>
    </DomainMessagesBoundary>
  );
}
