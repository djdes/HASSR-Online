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
 * Специальный режим организации (скан 83: «СпецРежим») — с пояснением, что
 * он включает и когда. С 2026-11-05 о нём не говорят нигде, кроме этой
 * страницы: нет пункта меню, шага на «Что делать сейчас» и карточки в
 * «Реквизитах». Адрес нейтральный — `/inspection/settings`, заголовок
 * «Настройки раздела»; вход — тихая ссылка внизу «Что делать сейчас».
 * Видят руководство и «проверка задач» (как раньше); переключает только
 * `admin.full` (как в API), остальным — «попросите руководителя».
 */
export default async function InspectionSpecialModePage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user) && !hasCapability(session.user, "tasks.verify")) forbidden();

  const t = await getTranslations("inspectionDay.pages.special");

  return (
    <div className="space-y-4">
      <SectionPageHeader description={t("lead")} />

      <PageGuide
        storageKey="inspection-settings"
        title={t("guideTitle")}
        bullets={[t("guide1"), t("guide2"), t("guide3")]}
      />

      {/* Спецрежим — на всю компанию: руководитель точки только смотрит. */}
      <InspectionSpecialModeCard canManage={hasCapability(session.user, "admin.full") && !isPointScoped(session.user)} />

      <InspectionHowItWorks id="when" title={t("whenTitle")} steps={[t("when1"), t("when2"), t("when3")]} />
    </div>
  );
}
