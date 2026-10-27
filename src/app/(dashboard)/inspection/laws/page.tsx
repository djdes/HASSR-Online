import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { NormDocumentsBody, NormDocumentsSanpinLink } from "@/components/production-control/norm-documents-body";

export const dynamic = "force-dynamic";

/**
 * «Нормативные документы» раздела «Пришла проверка» (эскиз 2026-10-28, фото
 * 6-го листа: «законы, СанПиН, ТР ТС и т. п.»): тот же список, что в
 * «Программе производственного контроля», но в своём разделе — левое меню не
 * переключается, человек остаётся в «Пришла проверка». Права — как там.
 */
export default async function InspectionLawsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const t = await getTranslations("productionControl");

  return (
    <DomainMessagesBoundary namespaces={["productionControl", "productionControlUi"]}>
      <div className="space-y-6">
        <SectionPageHeader description={t("norms.lead")} actions={<NormDocumentsSanpinLink />} />
        <NormDocumentsBody organizationId={organizationId} />
      </div>
    </DomainMessagesBoundary>
  );
}
