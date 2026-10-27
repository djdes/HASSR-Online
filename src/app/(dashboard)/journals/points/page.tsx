import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Settings2 } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { listPersonBuildings, loadBuildingContext } from "@/lib/active-building";
import { isOfficeBuilding } from "@/lib/building-scope";
import { buildingInScope } from "@/lib/point-scope";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { customJournalName } from "@/lib/custom-names";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { loadMessages } from "@/i18n/messages";
import { journalTitle } from "@/i18n/journal-presentation";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { PointJournalsClient, type PointJournalsCard } from "@/components/journals/point-journals-client";

export const dynamic = "force-dynamic";

/**
 * «Журналы точек» — корень раздела «Журналы» в «Торговых точках» (эскиз
 * 2026-10-28: «Журналы — список всех точек с журналами, которые ведутся, +
 * добавить/убрать журнал»). Каждая точка — карточка с журналами её набора;
 * правка меняет набор только этой точки (`POST /api/journals/points`). Без
 * деления журналов по точкам — одна карточка «Все точки» с набором компании.
 * Права — `admin.full`, как у назначения набора журналов.
 */
export default async function PointJournalsPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const locale = await getSiteLocale();
  const [t, messages, context, personBuildings, templates, customNames] = await Promise.all([
    getTranslations("pointJournals"),
    loadMessages(locale),
    loadBuildingContext(session),
    listPersonBuildings(session),
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { code: true, name: true },
    }),
    getOrgCustomNames(organizationId),
  ]);

  const journals = templates.map((template) => ({
    code: template.code,
    name: journalTitle(locale, messages.journals.names, template.code, template.name, customJournalName(customNames, template.code)),
  }));

  const targets: { id: string | null; name: string; address: string | null }[] = context.enabled
    ? personBuildings
        .filter((building) => !isOfficeBuilding(building) && buildingInScope(session.user, building.id))
        .map((building) => ({ id: building.id, name: building.name, address: building.address ?? null }))
    : [{ id: null, name: t("allPoints"), address: null }];
  const cards: PointJournalsCard[] = await Promise.all(
    targets.map(async (target) => {
      const disabled = await getDisabledJournalCodes(organizationId, target.id);
      return { ...target, enabledCodes: journals.filter((journal) => !disabled.has(journal.code)).map((journal) => journal.code) };
    }),
  );

  return (
    <div className="space-y-5" data-point-journals-page>
      <SectionPageHeader
        description={context.enabled ? t("lead") : t("leadShared")}
        actions={
          <Link
            href="/settings/sections/journals"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <Settings2 className="size-4 text-[#5566f6]" aria-hidden />
            {t("settings")}
          </Link>
        }
      />
      <PageGuide
        storageKey="point-journals"
        title={t("guide.title")}
        bullets={[t("guide.list"), t("guide.add"), t("guide.remove")]}
      />
      <DomainMessagesBoundary namespaces={["pointJournals"]}>
        <PointJournalsClient cards={cards} journals={journals} perPoint={context.enabled} />
      </DomainMessagesBoundary>
    </div>
  );
}
