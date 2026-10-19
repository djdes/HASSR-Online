import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { DOCUMENT_ORG_SELECT, buildDocumentOrgBlock, journalHeaderOrgText } from "@/lib/document-org-block";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { OrganizationBrandingForm } from "@/components/settings/organization-branding-form";

export const dynamic = "force-dynamic";

/**
 * «Моя компания → Логотип и цвета» (скан 82, лист 2, п. 2): логотип и
 * фирменный цвет с предпросмотром в шапке журнала и на QR-плакате. Раньше —
 * секция `#branding` формы реквизитов. Цвет клиента — только в документах и
 * на плакатах (план, раздел 7): кабинет не перекрашивается.
 */
export default async function OrganizationBrandingPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const [org, t, tProfile] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: DOCUMENT_ORG_SELECT }),
    getTranslations("settingsManagement.organizationProfile.brandingPage"),
    getTranslations("settingsManagement.organizationProfile"),
  ]);
  if (!org) notFound();
  // Шапка журнала на всю организацию — та же строка, что печатает PDF.
  const block = buildDocumentOrgBlock({ org });

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement", "journalPdf"]}>
      <div className="space-y-5">
        <SectionPageHeader description={t("description")} />
        <PageGuide
          title={t("guide.title")}
          storageKey="settings-organization-branding-v1"
          bullets={[
            { title: t("guide.logoTitle"), body: t("guide.logoBody") },
            { title: t("guide.colorTitle"), body: t("guide.colorBody") },
            { title: t("guide.cabinetTitle"), body: t("guide.cabinetBody") },
          ]}
          qa={[{ q: tProfile("guide.brandQuestion"), a: tProfile("guide.brandAnswer") }]}
        />
        <OrganizationBrandingForm
          initial={{ brandColor: org.brandColor, logoUrl: org.logoUrl }}
          headerText={journalHeaderOrgText(block)}
          orgName={block.org.journalName}
        />
      </div>
    </DomainMessagesBoundary>
  );
}
