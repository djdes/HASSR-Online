import { Building2, MapPin, MapPinOff, Wrench } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { AreaDialog } from "@/components/settings/area-dialog";
import { DeleteButton } from "@/components/settings/delete-button";
import { isManagementRole } from "@/lib/user-roles";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PageGuide } from "@/components/ui/page-guide";
import { PlaceFilterChips } from "@/components/layout/place-filter-chips";
import { BuildingGroupHeader } from "@/components/settings/building-group-header";
import { EquipmentQrButtons } from "@/components/settings/equipment-qr-buttons";
import { loadBuildingContext, listOrganizationBuildings } from "@/lib/active-building";
import { isOfficeBuilding, viewedPointId } from "@/lib/building-scope";
import { groupByBuilding } from "@/lib/area-building";
import { PLACE_ALL, PLACE_NONE, placeFilterParam, resolvePlaceFilter, scopePlaces } from "@/lib/place-filter";
import { buildingInScope } from "@/lib/point-scope";

export const dynamic = "force-dynamic";

export default async function AreasSettingsPage({
  searchParams,
}: {
  /** `place` — фильтр по местам над списком: id точки или офиса, `none`, `all`. */
  searchParams: Promise<{ place?: string | string[] }>;
}) {
  const query = await searchParams;
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const t = await getTranslations("settingsUi.areasPage");
  const tPlace = await getTranslations("settingsUi.placeFilter");

  const [areas, buildings, buildingContext] = await Promise.all([
    db.area.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { equipment: true } },
      },
    }),
    listOrganizationBuildings(orgId),
    loadBuildingContext(session),
  ]);
  // Точка → её цеха (2026-10-17); точек нет — плоский список, как раньше.
  // Фильтр по местам над списком — как у сотрудников (2026-10-28): без
  // выбора в адресе отмечена торговая точка из шапки. У точки — её цеха и
  // цеха без точки (они видны на каждой точке), «Без точки» — только они.
  // Места — только точки человека (как в переключателе шапки): руководитель
  // точки чужих точек не видит.
  const viewedPoint = viewedPointId(buildingContext);
  const showPlaceFilter = buildingContext.enabled;
  const scope = scopePlaces({
    items: areas,
    buildingIdOf: (area) => area.buildingId,
    buildings,
    scopeIds: showPlaceFilter
      ? new Set(buildingContext.buildings.filter((building) => buildingInScope(session.user, building.id)).map((building) => building.id))
      : null,
  });
  const place = resolvePlaceFilter({
    requested: showPlaceFilter ? placeFilterParam(query.place) : null,
    places: scope.buildings.map((building) => building.id),
    hasNone: scope.loose.length > 0,
    headerPointId: viewedPoint,
  });
  const placePointId = place && place !== PLACE_NONE ? place : null;
  const groups = groupByBuilding(scope.items, (area) => area.buildingId, scope.buildings, {
    activeBuildingId: placePointId,
    keepEmpty: true,
  }).filter((group) => place !== PLACE_NONE || group.building === null);
  const buildingOptions = buildings.map((building) => ({ id: building.id, name: building.name }));
  // Оборудование цехов на экране — для кнопок QR: они печатают то же, что в списке.
  const visibleAreas = buildings.length === 0 ? areas : groups.flatMap((group) => group.items);
  const equipmentCount = visibleAreas.reduce((sum, area) => sum + area._count.equipment, 0);
  const qrPoint = showPlaceFilter ? (place === PLACE_NONE ? PLACE_NONE : (placePointId ?? PLACE_ALL)) : null;
  // Новый цех — в отмеченную точку, а если точка одна — в неё.
  const defaultBuildingId = placePointId ?? (buildings.length === 1 ? buildings[0].id : null);

  const canManage = isManagementRole(session.user.role);
  // Раньше: isManagerRole — только role=manager. head_chef видел список,
  // но кнопка «Удалить» была скрыта, хотя API уже разрешает делете
  // (после фикса /api/areas/[id] DELETE на hasFullWorkspaceAccess).
  // Согласовываем UI с API, плюс ROOT-impersonation также проходит.
  const canDelete = hasFullWorkspaceAccess({
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>

          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <Building2 className="size-5" />
            </div>
            <div>
              <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
                {t("title")}
              </h1>
              <p className="mt-0.5 text-[14px] text-[#6f7282]">
                {buildings.length > 1
                  ? t("subtitleByPoints")
                  : t("subtitle")}
              </p>
            </div>
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Те же QR, что на «Оборудовании» (скан 98): оборудование цехов из списка, таблички — по цехам. */}
            {equipmentCount > 0 ? <EquipmentQrButtons point={qrPoint} /> : null}
            {/* key — новая точка по умолчанию после смены фильтра (окно помнит выбор до закрытия). */}
            <AreaDialog key={defaultBuildingId ?? "none"} buildings={buildingOptions} defaultBuildingId={defaultBuildingId} />
          </div>
        ) : null}
      </div>

      <PageGuide
        storageKey="settings-areas"
        title={t("guideTitle")}
        bullets={[
          {
            title: t("guide1Title"),
            body: t("guide1Body"),
          },
          {
            title: t("guide2Title"),
            body: t("guide2Body"),
          },
          {
            title: t("guide3Title"),
            body: t("guide3Body"),
          },
          {
            title: t("guide4Title"),
            body: t("guide4Body"),
          },
        ]}
      />

      {showPlaceFilter ? (
        <PlaceFilterChips
          kind="areas"
          label={tPlace("label")}
          basePath="/settings/areas"
          active={place}
          all={{ label: tPlace("all"), count: scope.items.length, icon: Building2 }}
          places={scope.buildings.map((building) => ({
            id: building.id,
            name: building.name,
            office: isOfficeBuilding(building),
            count: scope.items.filter((area) => area.buildingId === building.id).length,
          }))}
          none={scope.loose.length > 0 ? { label: tPlace("none"), count: scope.loose.length, icon: MapPinOff } : null}
        />
      ) : null}

      {/* Content */}
      {areas.length === 0 && buildings.length === 0 ? (
        <EmptyState canManage={canManage} />
      ) : buildings.length === 0 ? (
        <AreasTable
          areas={areas}
          canManage={canManage}
          canDelete={canDelete}
          buildings={buildingOptions}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.building?.id ?? "loose"} className="space-y-3" data-testid="area-building-group">
              <BuildingGroupHeader
                building={group.building}
                countLabel={t("workshopCount", { count: group.items.length })}
                looseHint={t("looseHint")}
              />
              {group.items.length > 0 ? (
                <AreasTable
                  areas={group.items}
                  canManage={canManage}
                  canDelete={canDelete}
                  buildings={buildingOptions}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-6 text-[13px] text-[#6f7282]">
                  {t("emptyPoint")}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type AreaRow = {
  id: string;
  name: string;
  description: string | null;
  buildingId: string | null;
  _count: { equipment: number };
};

function AreasTable({
  areas,
  canManage,
  canDelete,
  buildings,
}: {
  areas: AreaRow[];
  canManage: boolean;
  canDelete: boolean;
  buildings: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("settingsUi.areasPage");
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <table className="w-full min-w-[560px] text-[15px]">
        <thead className="bg-[#f8f9fc] text-[13px] text-[#6f7282]">
          <tr>
            <th className="px-6 py-3 text-left font-medium">{t("colName")}</th>
            <th className="px-6 py-3 text-left font-medium">{t("colDescription")}</th>
            <th className="px-6 py-3 text-center font-medium">
              {t("colEquipment")}
            </th>
            {canManage && (
              <th className="w-[100px] px-6 py-3 text-right font-medium">
                {t("colActions")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => (
            <tr
              key={area.id}
              className="border-t border-[#f0f1f8] transition-colors hover:bg-[#fafbff]"
            >
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-[#f5f6ff] text-[#5566f6]">
                    <MapPin className="size-4" />
                  </div>
                  <span className="font-medium text-[#0b1024]">
                    {area.name}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 text-[#6f7282]">
                {area.description || "—"}
              </td>
              <td className="px-6 py-4 text-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] font-medium text-[#5566f6]">
                  <Wrench className="size-3" />
                  {area._count.equipment}
                </span>
              </td>
              {canManage && (
                <td className="px-6 py-4">
                  <div className="flex justify-end gap-1">
                    <AreaDialog
                      area={{
                        id: area.id,
                        name: area.name,
                        description: area.description,
                        buildingId: area.buildingId,
                      }}
                      buildings={buildings}
                    />
                    {canDelete && (
                      <DeleteButton
                        id={area.id}
                        endpoint="/api/areas"
                        entityName={t("entityName", { name: area.name })}
                        usageEndpoint={`/api/areas/${area.id}/usage`}
                      />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ canManage }: { canManage: boolean }) {
  const t = useTranslations("settingsUi.areasPage");
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white px-8 py-16 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#eef1ff]">
        <Building2 className="size-7 text-[#5566f6]" />
      </div>
      <h3 className="mt-5 text-[17px] font-semibold text-[#0b1024]">
        {t("emptyTitle")}
      </h3>
      <p className="mt-2 text-[14px] text-[#6f7282]">
        {canManage
          ? t("emptyAdd")
          : t("emptyNone")}
      </p>
    </div>
  );
}
