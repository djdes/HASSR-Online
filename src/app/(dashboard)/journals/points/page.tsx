import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ClipboardList, Settings2 } from "lucide-react";
import { PlaceFilterChips } from "@/components/layout/place-filter-chips";
import { placeFilterParam, resolvePlaceFilter } from "@/lib/place-filter";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { listPersonBuildings, loadBuildingContext } from "@/lib/active-building";
import { isOfficeBuilding, journalsPointMode } from "@/lib/building-scope";
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
import { PointModeUnavailable } from "@/components/journals/point-mode-unavailable";
import { PointJournalsClient, type PointJournalsCard } from "@/components/journals/point-journals-client";

export const dynamic = "force-dynamic";

/**
 * «Журналы точек» — корень раздела «Журналы» в «Торговых точках» (эскиз
 * 2026-10-28: «Журналы — список всех точек с журналами, которые ведутся, +
 * добавить/убрать журнал»). Каждая точка — карточка с журналами её набора;
 * правка меняет набор только этой точки (`POST /api/journals/points`). Без
 * деления журналов по точкам — одна карточка «Все точки» с набором компании.
 * Права — `admin.full`, как у назначения набора журналов. Над карточками —
 * фильтр по точкам, как у сотрудников (2026-10-28, `?place=`); счётчик —
 * журналы в работе.
 */
export default async function PointJournalsPage({
  searchParams,
}: {
  searchParams: Promise<{ place?: string | string[] }>;
}) {
  const query = await searchParams;
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/journals");
  // В шапке выбрана торговая точка — страница всей организации закрыта.
  const pointContext = await loadBuildingContext(session);
  if (journalsPointMode(pointContext)) {
    return (
      <PointModeUnavailable
        pointName={pointContext.activeBuilding?.name ?? ""}
        canViewOrganization={pointContext.canViewOrganization}
      />
    );
  }
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
  // Фильтр по точкам — как у сотрудников; страница открыта только при «Вся
  // организация» в шапке, поэтому без выбора в адресе — все точки.
  const pointCards = cards.filter((card): card is PointJournalsCard & { id: string } => card.id !== null);
  const showPlaceFilter = context.enabled && pointCards.length >= 2;
  const place = showPlaceFilter
    ? resolvePlaceFilter({
        requested: placeFilterParam(query.place),
        places: pointCards.map((card) => card.id),
        hasNone: false,
        headerPointId: null,
      })
    : null;
  const tPlace = await getTranslations("settingsUi.placeFilter");

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
      {showPlaceFilter ? (
        <PlaceFilterChips
          kind="point-journals"
          label={tPlace("label")}
          basePath="/journals/points"
          active={place}
          all={{
            label: tPlace("all"),
            count: pointCards.reduce((sum, card) => sum + card.enabledCodes.length, 0),
            icon: ClipboardList,
          }}
          places={pointCards.map((card) => ({ id: card.id, name: card.name, office: false, count: card.enabledCodes.length }))}
        />
      ) : null}
      <DomainMessagesBoundary namespaces={["pointJournals"]}>
        <PointJournalsClient
          // Набор журналов в карточках — состояние клиента: при смене фильтра собираем заново.
          key={place ?? "all"}
          cards={place ? cards.filter((card) => card.id === place) : cards}
          journals={journals}
          perPoint={context.enabled}
        />
      </DomainMessagesBoundary>
    </div>
  );
}
