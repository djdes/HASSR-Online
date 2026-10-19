import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { loadBuildingContext } from "@/lib/active-building";
import { readLegalProfile } from "@/lib/org-legal-profile";
import { DOCUMENT_POINT_SELECT } from "@/lib/document-org-block";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { OrganizationDocumentsForm } from "@/components/settings/organization-documents-form";

export const dynamic = "force-dynamic";

/**
 * «Моя компания → Сведения для документов» (скан 82, лист 2): один блок
 * сведений «в любом документе» — об организации и о торговой точке — с живым
 * предпросмотром шапки журнала. Раньше — секция `#documents` формы реквизитов.
 */
export default async function OrganizationDocumentsPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const [org, points, context, t] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        inn: true,
        address: true,
        phone: true,
        journalShortName: true,
        legalProfileJson: true,
        legalFullName: true,
        kpp: true,
        ogrn: true,
        legalAddress: true,
        directorName: true,
        directorPost: true,
      },
    }),
    db.building.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, ...DOCUMENT_POINT_SELECT },
    }),
    loadBuildingContext(session),
    getTranslations("settingsManagement.organizationProfile.documentsPage"),
  ]);
  if (!org) notFound();
  const { legalProfileJson, ...orgFields } = org;

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
      <div className="space-y-5">
        <SectionPageHeader description={t("description")} />
        <PageGuide
          title={t("guide.title")}
          storageKey="settings-organization-documents-v1"
          bullets={[
            { title: t("guide.registryTitle"), body: t("guide.registryBody") },
            { title: t("guide.pointTitle"), body: t("guide.pointBody") },
            { title: t("guide.whereTitle"), body: t("guide.whereBody") },
          ]}
          qa={[{ q: t("guide.refreshQuestion"), a: t("guide.refreshAnswer") }]}
        />
        <OrganizationDocumentsForm
          org={orgFields}
          legalProfile={readLegalProfile(legalProfileJson)}
          points={points}
          // Точка из шапки кабинета — её шапку и показываем первой.
          initialPointId={context.activeBuildingId}
        />
      </div>
    </DomainMessagesBoundary>
  );
}
