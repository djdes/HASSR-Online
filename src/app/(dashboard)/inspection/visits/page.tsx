import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { listInspectionVisits } from "@/lib/inspection-visits.server";
import { InspectionVisitsCard } from "@/components/inspection/inspection-visits-card";
import { InspectionHowItWorks } from "@/components/inspection/inspection-how-it-works";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeaderStat } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * «Журнал посещений» раздела «Пришла проверка» (скан 83: «отметка в журнале
 * посещения ⇒ отсылка к документу проверки»). Право — как у журнала
 * (`canUseInspectionVisits`): руководство или «проверка задач». Скрывать
 * ошибочные записи — руководителю (`canHideInspectionVisits`, admin.full).
 */
export default async function InspectionVisitsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user) && !hasCapability(session.user, "tasks.verify")) forbidden();
  const organizationId = getActiveOrgId(session);

  const [visits, org, t] = await Promise.all([
    // Со скрытыми: показать их можно переключателем в журнале.
    listInspectionVisits(organizationId, { includeHidden: true }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    getTranslations("inspectionDay"),
  ]);
  const shown = visits.filter((visit) => !visit.hiddenAt).length;

  return (
    <div className="space-y-4">
      <SectionPageHeader
        description={t("pages.visits.lead")}
        actions={shown > 0 ? <PageHeaderStat>{t("visits.count", { count: shown })}</PageHeaderStat> : null}
      />

      <PageGuide
        storageKey="inspection-visits"
        title={t("pages.visits.guideTitle")}
        bullets={[t("pages.visits.guide1"), t("pages.visits.guide2"), t("pages.visits.guide3")]}
        qa={[
          { q: t("pages.visits.q1"), a: t("pages.visits.a1") },
          { q: t("pages.visits.q2"), a: t("pages.visits.a2") },
        ]}
      />

      <InspectionHowItWorks
        id="visits"
        title={t("pages.visits.howTitle")}
        steps={[t("pages.visits.how1"), t("pages.visits.how2"), t("pages.visits.how3")]}
      />

      <section
        id="visits"
        className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      >
        <InspectionVisitsCard
          visits={visits}
          timeZone={org?.timezone || "Europe/Moscow"}
          canHide={hasCapability(session.user, "admin.full")}
        />
      </section>
    </div>
  );
}
