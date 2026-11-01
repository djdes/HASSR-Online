import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { isPointScoped } from "@/lib/point-scope";
import { InspectionSpecialModeCard } from "@/components/inspection/inspection-special-mode-card";
import { InspectionHowItWorks } from "@/components/inspection/inspection-how-it-works";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

/**
 * «Спецрежим» раздела «Пришла проверка» (скан 83: «СпецРежим»): специальный
 * режим организации с пояснением, что он выключает и когда его включать.
 * Видят руководство и «проверка задач»; переключает только `admin.full` (как
 * в API), остальным — «попросите руководителя». Короткий блок с якорем
 * `#special-mode` остаётся на «Что делать сейчас» (ссылка из «Реквизитов»).
 */
export default async function InspectionSpecialModePage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user) && !hasCapability(session.user, "tasks.verify")) forbidden();

  const t = await getTranslations("inspectionDay.pages.special");

  return (
    <div className="space-y-4">
      <SectionPageHeader description={t("lead")} />

      <PageGuide
        storageKey="inspection-special-mode"
        title={t("guideTitle")}
        bullets={[t("guide1"), t("guide2"), t("guide3")]}
      />

      {/* Спецрежим — на всю компанию: руководитель точки только смотрит. */}
      <InspectionSpecialModeCard canManage={hasCapability(session.user, "admin.full") && !isPointScoped(session.user)} />

      <InspectionHowItWorks id="special-mode" title={t("whenTitle")} steps={[t("when1"), t("when2"), t("when3")]} />
    </div>
  );
}
