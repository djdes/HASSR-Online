import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { PageHeader } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integration-crypto";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { connectionView, readIikoOptions } from "@/lib/supply/connections";

import { IikoSettingsClient } from "./iiko-settings-client";

export const dynamic = "force-dynamic";

const LINK =
  "inline-flex h-10 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

/**
 * iiko (сервер iikoOffice / iiko RMS): приходные накладные — во «Входящие»,
 * акты списания — в «Потери», товары и заготовки — в справочник продуктов.
 * Пароль — только зашифрованным; на странице — адрес и логин.
 */
export default async function IikoSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const [t, organization, row] = await Promise.all([
    getTranslations("supplyEdo.iiko"),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.supplyConnection.findUnique({ where: { organizationId_provider: { organizationId, provider: "iiko" } } }),
  ]);
  let credentials: unknown = null;
  if (row) {
    try {
      credentials = JSON.parse(decryptSecret(row.credentialsEnc));
    } catch {
      credentials = null;
    }
  }
  const options = readIikoOptions((credentials as { options?: unknown } | null)?.options);

  return (
    <DomainMessagesBoundary namespaces={["supplyEdo"]}>
      <div className="space-y-5">
        <PageHeader
          eyebrow={t("eyebrow")}
          title={t("title")}
          description={t("description")}
          actions={
            <>
              <Link href="/edo" className={LINK}>{t("openInbox")}</Link>
              <Link href="/losses" className={LINK}>{t("openLosses")}</Link>
              <Link href="/settings/products" className={LINK}>{t("openProducts")}</Link>
            </>
          }
        />
        <IikoSettingsClient
          view={row ? connectionView("iiko", credentials, row) : null}
          options={options}
          timeZone={organization?.timezone || "Europe/Moscow"}
        />
        <p className="text-[13px] leading-relaxed text-[#6f7282]">
          {t("secretsNote")} {t("licenseNote")}
        </p>
      </div>
    </DomainMessagesBoundary>
  );
}
