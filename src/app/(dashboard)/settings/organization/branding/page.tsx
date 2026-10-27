import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { DOCUMENT_ORG_SELECT, buildDocumentOrgBlock } from "@/lib/document-org-block";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { OrganizationBrandingForm } from "@/components/settings/organization-branding-form";

export const dynamic = "force-dynamic";

/**
 * «Моя компания → Фирменный стиль»: логотип, три цвета, сайт и настройки QR
 * с предпросмотром плаката, QR-наклейки и этикетки (2026-10-27). Цвет клиента
 * — только в печати (плакаты, QR, таблички, этикетки): кабинет не
 * перекрашивается, журналы остаются чёрно-белыми.
 */
export default async function OrganizationBrandingPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const [org, t, tProfile] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        ...DOCUMENT_ORG_SELECT,
        brandColor2: true,
        brandColor3: true,
        website: true,
        qrIconUrl: true,
        qrBrandFrame: true,
        qrCenterLogo: true,
      },
    }),
    getTranslations("settingsManagement.organizationProfile.brandingPage"),
    getTranslations("settingsManagement.organizationProfile"),
  ]);
  if (!org) notFound();
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
          initial={{
            brandColor: org.brandColor,
            brandColor2: org.brandColor2,
            brandColor3: org.brandColor3,
            website: org.website,
            qrBrandFrame: org.qrBrandFrame,
            qrCenterLogo: org.qrCenterLogo,
            logoUrl: org.logoUrl,
            qrIconUrl: org.qrIconUrl,
          }}
          orgName={block.org.journalName}
        />
      </div>
    </DomainMessagesBoundary>
  );
}
