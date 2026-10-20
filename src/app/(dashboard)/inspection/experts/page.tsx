import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Handshake } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { readActiveServices } from "@/lib/services/catalog";
import {
  INSPECTION_EXPERT_SERVICES,
  InspectionExpertsCard,
} from "@/components/inspection/inspection-experts-card";
import { InspectionHowItWorks } from "@/components/inspection/inspection-how-it-works";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

/**
 * «Подготовка с экспертом и выезд» (скан 83: «модуль подготовки — платно;
 * выезд — платно»): карточки существующих услуг каталога, заказ — на странице
 * услуг (`/settings/services?order=<ключ>`). Право — как у карточки экспертов
 * на прежней странице: руководство (`hasFullWorkspaceAccess`).
 */
export default async function InspectionExpertsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/inspection");

  const [services, t] = await Promise.all([
    readActiveServices().catch(() => []),
    getTranslations("inspectionDay.pages.experts"),
  ]);
  const available = INSPECTION_EXPERT_SERVICES.some((item) => services.some((service) => service.key === item.key));

  return (
    <div className="space-y-4">
      <SectionPageHeader description={t("lead")} />

      <PageGuide
        storageKey="inspection-experts"
        title={t("guideTitle")}
        bullets={[t("guide1"), t("guide2")]}
        qa={[{ q: t("q1"), a: t("a1") }]}
      />

      <InspectionHowItWorks id="experts" title={t("howTitle")} steps={[t("how1"), t("how2"), t("how3")]} />

      {available ? (
        <InspectionExpertsCard services={services} />
      ) : (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center" data-experts-empty>
          <Handshake className="mx-auto size-6 text-[#9b9fb3]" aria-hidden />
          <div className="mt-2 text-[15px] font-medium text-[#0b1024]">{t("empty")}</div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">{t("emptyHint")}</p>
          <Link
            href="/settings/services"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {t("emptyLink")}
            <ArrowRight className="size-4 text-[#5566f6]" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
