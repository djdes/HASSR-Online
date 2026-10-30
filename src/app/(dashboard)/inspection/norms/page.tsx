import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadInspectionNorms } from "@/lib/inspection-norms.server";
import { InspectionNormsCard } from "@/components/inspection/inspection-norms-card";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

/**
 * «Нормативка» раздела «Пришла проверка» (скан 83: «Нормативка из ХАССП —
 * ЭлППК», план 4.6): ППК, план ХАССП и нормы СанПиН — только чтение. Открыта
 * и заведующей (те же права, что у документов ППК). Ссылки — прямо на файлы
 * (PDF скачивается, подписанный экземпляр — в новой вкладке): левое меню не
 * переключается на «Производственный контроль».
 */
export default async function InspectionNormsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user) && !hasCapability(session.user, "tasks.verify")) forbidden();
  const organizationId = getActiveOrgId(session);

  const [norms, t] = await Promise.all([loadInspectionNorms(organizationId), getTranslations("inspectionDay.pages.norms")]);

  return (
    <div className="space-y-4">
      <SectionPageHeader description={t("lead")} />

      <PageGuide
        storageKey="inspection-norms"
        title={t("guideTitle")}
        bullets={[t("guide1"), t("guide2"), t("guide3")]}
        qa={[{ q: t("q1"), a: t("a1") }]}
      />

      <InspectionNormsCard norms={norms} bare />
    </div>
  );
}
