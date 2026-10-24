import { Building2, MapPin, Wrench } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { AreaDialog } from "@/components/settings/area-dialog";
import { DeleteButton } from "@/components/settings/delete-button";
import { isManagementRole } from "@/lib/user-roles";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PageGuide } from "@/components/ui/page-guide";
import { BuildingGroupHeader } from "@/components/settings/building-group-header";
import { loadBuildingContext, listOrganizationBuildings } from "@/lib/active-building";
import { groupByBuilding } from "@/lib/area-building";

export const dynamic = "force-dynamic";

export default async function AreasSettingsPage() {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const t = await getTranslations("settingsUi.areasPage");

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
  // Точка → её цеха (2026-10-17). Выбрана точка в шапке — только она и
  // цеха без точки; точек нет — плоский список, как раньше.
  const groups = groupByBuilding(areas, (area) => area.buildingId, buildings, {
    activeBuildingId: buildingContext.activeBuildingId,
    keepEmpty: true,
  });
  const buildingOptions = buildings.map((building) => ({ id: building.id, name: building.name }));
  // Новый цех — в точку из шапки, а если точка одна — в неё.
  const defaultBuildingId =
    buildingContext.activeBuildingId ?? (buildings.length === 1 ? buildings[0].id : null);

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
        {canManage && <AreaDialog buildings={buildingOptions} defaultBuildingId={defaultBuildingId} />}
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
