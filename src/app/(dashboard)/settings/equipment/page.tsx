import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import type { Prisma } from "@prisma/client";
import { TemperatureChart } from "@/components/charts/temperature-chart";
import {
  AlertTriangle,
  MapPin,
  Thermometer,
  Wifi,
  WifiOff,
  Wrench,
  ThermometerSun,
} from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { CopyIdButton } from "@/components/settings/copy-id-button";
import { EquipmentDialog } from "@/components/settings/equipment-dialog";
import { DeleteButton } from "@/components/settings/delete-button";
import { PageGuide } from "@/components/ui/page-guide";
import { getUserDisplayTitle, isManagementRole } from "@/lib/user-roles";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { BuildingGroupHeader } from "@/components/settings/building-group-header";
import { EquipmentQrButtons } from "@/components/settings/equipment-qr-buttons";
import { loadBuildingContext, listOrganizationBuildings } from "@/lib/active-building";
import { isOfficeBuilding, viewedPointId } from "@/lib/building-scope";
import { buildPlaceOptions, groupByBuilding } from "@/lib/area-building";
import { isUvLampEquipment, lampRemainingHours } from "@/lib/uv-lamp";

export const dynamic = "force-dynamic";

type EquipmentTypeT = ReturnType<typeof useTranslations<"settingsManagement.points.equipmentTypes">>;

function equipmentTypeLabel(t: EquipmentTypeT, type: string): string {
  switch (type) {
    case "refrigerator":
      return t("refrigerator");
    case "freezer":
      return t("freezer");
    case "oven":
      return t("oven");
    case "dishwasher":
      return t("dishwasher");
    case "scale":
      return t("scale");
    case "thermometer":
      return t("thermometer");
    case "sensor":
      return t("sensor");
    case "uv_lamp":
      return t("uv_lamp");
    case "fryer":
      return t("fryer");
    case "other":
      return t("other");
    default:
      return type;
  }
}

type TempRangeT = ReturnType<typeof useTranslations<"settingsUi.equipmentPage">>;

function tempRange(t: TempRangeT, min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${min}°C … ${max}°C`;
  if (min !== null) return t("tempFrom", { value: min });
  if (max !== null) return t("tempTo", { value: max });
  return "—";
}

function lampLeftLabel(t: TempRangeT, lifetimeHours: number | null, usedHours: number): string {
  const remaining = lampRemainingHours(lifetimeHours, usedHours);
  return remaining === null ? "—" : t("lampLeft", { hours: Math.round(remaining) });
}

export default async function EquipmentSettingsPage() {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const t = await getTranslations("settingsUi.equipmentPage");

  const [equipment, areas, staff, buildings, rooms, buildingContext] = await Promise.all([
    db.equipment.findMany({
      where: { area: { organizationId: orgId } },
      orderBy: { name: "asc" },
      include: { area: { select: { id: true, name: true, buildingId: true } } },
    }),
    db.area.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, buildingId: true },
    }),
    db.user.findMany({
      where: { organizationId: orgId, ...ORG_ROSTER_WHERE },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, positionTitle: true, canManageSettings: true, jobPosition: { select: { name: true } } },
    }),
    listOrganizationBuildings(orgId),
    db.room.findMany({
      where: { building: { organizationId: orgId } },
      select: { id: true, name: true, buildingId: true },
    }),
    loadBuildingContext(session),
  ]);
  // Точка → помещение → оборудование (2026-10-17). Выбрана точка в шапке —
  // её оборудование и оборудование цехов без точки.
  // Торговая точка из шапки; «Вся организация» или офис — все точки.
  const viewedPoint = viewedPointId(buildingContext);
  // Офис — не торговая точка: в списке он, только если у него есть свои объекты.
  const groupBuildings = buildings.filter(
    (building) => !isOfficeBuilding(building) || equipment.some((item) => item.area.buildingId === building.id),
  );
  const groups = groupByBuilding(equipment, (item) => item.area.buildingId, groupBuildings, {
    activeBuildingId: viewedPoint,
    keepEmpty: true,
  });
  const buildingOptions = buildings.map((building) => ({ id: building.id, name: building.name }));
  // Сколько оборудования на экране (точка из шапки и цеха без точки) — для кнопок QR.
  const visibleCount = buildings.length === 0 ? equipment.length : groups.reduce((sum, group) => sum + group.items.length, 0);
  const places = buildPlaceOptions({ buildings, areas, rooms });
  const defaultBuildingId = viewedPoint ?? (buildings.length === 1 ? buildings[0].id : null);
  // «Кто заполняет» по QR: руководство заполняет любой объект — в выборе не нужно.
  const fillerOptions = staff.map((user) => ({
    id: user.id,
    name: user.name,
    position: getUserDisplayTitle(user) || null,
    management: isManagementRole(user.role) || user.canManageSettings,
  }));

  // IoT readings
  const iotIds = equipment.filter((e) => e.tuyaDeviceId).map((e) => e.id);
  const readings: Record<string, { temp: number; time: Date }> = {};
  for (const eqId of iotIds) {
    const entry = await db.journalEntry.findFirst({
      where: {
        equipmentId: eqId,
        data: { path: ["source"], string_contains: "tuya" },
      },
      orderBy: { createdAt: "desc" },
      select: { data: true, createdAt: true },
    });
    if (entry?.data && typeof entry.data === "object") {
      const d = entry.data as Record<string, unknown>;
      if (d.temperature != null)
        readings[eqId] = { temp: Number(d.temperature), time: entry.createdAt };
    }
  }

  const equipmentNames = equipment.map((item) => item.name);
  const canManage = isManagementRole(session.user.role);
  // Согласовано с DELETE /api/equipment/[id] на hasFullWorkspaceAccess.
  // Раньше head_chef видел список, но кнопка «Удалить» была скрыта.
  const canDelete = hasFullWorkspaceAccess({
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  });

  const dialogProps: EquipmentDialogShared = {
    areas,
    buildings: buildingOptions,
    places,
    existingNames: equipmentNames,
    fillerOptions,
  };

  // Датчики температуры (раньше — на главной, меню 2026-10-16).
  const iotEquipment = equipment
    .filter((item) => item.tuyaDeviceId)
    .map((item) => ({ id: item.id, name: item.name, tuyaDeviceId: item.tuyaDeviceId }));

  return (
    <div className="space-y-5">
      {iotEquipment.length > 0 ? (
        <section className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
              <ThermometerSun className="size-5" />
            </span>
            <h2 className="text-[18px] font-semibold text-[#0b1024]">{t("sensorsTitle")}</h2>
          </div>
          <TemperatureChart equipmentList={iotEquipment} />
        </section>
      ) : null}
      <PageGuide
        title={t("guideTitle")}
        storageKey="settings-equipment-v2"
        bullets={[
          { title: t("guide1Title"), body: t("guide1Body") },
          { title: t("guide2Title"), body: t("guide2Body") },
          { title: t("guide3Title"), body: t("guide3Body") },
          { title: t("guide4Title"), body: t("guide4Body") },
          { title: t("guide5Title"), body: t("guide5Body") },
          { title: t("guide6Title"), body: t("guide6Body") },
        ]}
        qa={[
          { q: t("qa1Q"), a: t("qa1A") },
          { q: t("qa2Q"), a: t("qa2A") },
        ]}
      />
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>

          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#f0edff] text-[#7a5cff]">
              <Wrench className="size-5" />
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
        <div className="flex flex-wrap items-center gap-2">
          {/* QR — оборудование точки из шапки (скан 98: раньше печаталось всё оборудование организации). */}
          {canManage && visibleCount > 0 ? <EquipmentQrButtons /> : null}
          {canManage && (
            <EquipmentDialog
              areas={areas}
              buildings={buildingOptions}
              places={places}
              defaultBuildingId={defaultBuildingId}
              existingNames={equipmentNames}
              fillerOptions={fillerOptions}
            />
          )}
        </div>
      </div>

      {/* Content */}
      {equipment.length === 0 ? (
        <div className="rounded-2xl border border-[#ececf4] bg-white px-8 py-16 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#f0edff]">
            <Wrench className="size-7 text-[#7a5cff]" />
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
      ) : (
        buildings.length === 0 ? (
          <EquipmentTable
            items={equipment}
            readings={readings}
            canManage={canManage}
            canDelete={canDelete}
            dialog={dialogProps}
          />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.building?.id ?? "loose"} className="space-y-3" data-testid="equipment-building-group">
                <BuildingGroupHeader
                  building={group.building}
                  countLabel={t("unitCount", { count: group.items.length })}
                  looseHint={t("looseHint")}
                />
                {group.items.length > 0 ? (
                  <EquipmentTable
                    items={group.items}
                    readings={readings}
                    canManage={canManage}
                    canDelete={canDelete}
                    dialog={dialogProps}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-6 text-[13px] text-[#6f7282]">
                    {t("emptyPoint")}
                  </div>
                )}
              </section>
            ))}
          </div>
        )
      )}
    </div>
  );
}

type EquipmentDialogShared = Pick<
  ComponentProps<typeof EquipmentDialog>,
  "areas" | "buildings" | "places" | "existingNames" | "fillerOptions"
>;

type EquipmentRow = Prisma.EquipmentGetPayload<{
  include: { area: { select: { id: true; name: true; buildingId: true } } };
}>;

function EquipmentTable({
  items,
  readings,
  canManage,
  canDelete,
  dialog,
}: {
  items: EquipmentRow[];
  readings: Record<string, { temp: number; time: Date }>;
  canManage: boolean;
  canDelete: boolean;
  dialog: EquipmentDialogShared;
}) {
  const t = useTranslations("settingsUi.equipmentPage");
  const tTypes = useTranslations("settingsManagement.points.equipmentTypes");
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <table className="w-full min-w-[720px] text-[15px]">
        <thead className="bg-[#f8f9fc] text-[13px] text-[#6f7282]">
          <tr>
            {/* Закреплена: на телефоне таблицу крутят вбок, и без
                названия остаются безымянные строки. */}
            <th className="sticky left-0 z-10 bg-[#f8f9fc] px-6 py-3 text-left font-medium">
              {t("colName")}
            </th>
            <th className="px-6 py-3 text-left font-medium">{t("colType")}</th>
            <th className="px-6 py-3 text-left font-medium">{t("colRoom")}</th>
            <th className="px-6 py-3 text-left font-medium">{t("colRange")}</th>
            <th className="px-6 py-3 text-center font-medium">IoT</th>
            {canManage && (
              <th className="w-[100px] px-6 py-3 text-right font-medium">
                {t("colActions")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const reading = readings[item.id];
            const minutesAgo = reading
              ? Math.round(
                  (Date.now() - reading.time.getTime()) / 60000
                )
              : null;
            const online =
              minutesAgo !== null && minutesAgo <= 120;
            const outOfRange =
              reading &&
              ((item.tempMin != null && reading.temp < item.tempMin) ||
                (item.tempMax != null && reading.temp > item.tempMax));

            return (
              <tr
                key={item.id}
                className="border-t border-[#f0f1f8] transition-colors hover:bg-[#fafbff]"
              >
                <td className="sticky left-0 z-10 bg-white px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-[#f5f3ff] text-[#7a5cff]">
                      <Thermometer className="size-4" />
                    </div>
                    <div>
                      <div className="font-medium text-[#0b1024]">
                        {item.name}
                      </div>
                      {item.serialNumber && (
                        <div className="text-[12px] text-[#9b9fb3]">
                          S/N {item.serialNumber}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-[#6f7282]">
                  {equipmentTypeLabel(tTypes, item.type)}
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1.5 text-[14px] text-[#6f7282]">
                    <MapPin className="size-3" />
                    {item.area.name}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-[14px] text-[#0b1024]">
                  {/* У УФ-лампы температуры нет — показываем остаток ресурса. */}
                  {isUvLampEquipment(item)
                    ? lampLeftLabel(t, item.lampLifetimeHours, item.lampUsedHours)
                    : tempRange(t, item.tempMin, item.tempMax)}
                </td>
                <td className="px-6 py-4 text-center">
                  {item.tuyaDeviceId ? (
                    <div className="inline-flex flex-col items-center gap-1">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          online
                            ? "bg-[#ecfdf5] text-[#136b2a]"
                            : "bg-[#fff4f2] text-[#d2453d]"
                        }`}
                      >
                        {online ? (
                          <Wifi className="size-3" />
                        ) : (
                          <WifiOff className="size-3" />
                        )}
                        {online ? "Online" : "Offline"}
                      </span>
                      {reading && (
                        <span
                          className={`inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums ${
                            outOfRange
                              ? "text-[#d2453d]"
                              : "text-[#136b2a]"
                          }`}
                        >
                          {outOfRange && (
                            <AlertTriangle className="size-3" />
                          )}
                          {reading.temp}°C
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[13px] text-[#c7ccea]">—</span>
                  )}
                </td>
                {canManage && (
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-1">
                      <CopyIdButton
                        id={item.id}
                        hint={t("copyIdHint")}
                      />
                      <EquipmentDialog
                        {...dialog}
                        equipmentBuildingId={item.area.buildingId}
                        equipment={{
                          id: item.id,
                          name: item.name,
                          type: item.type,
                          areaId: item.area.id,
                          serialNumber: item.serialNumber,
                          tempMin: item.tempMin,
                          tempMax: item.tempMax,
                          tuyaDeviceId: item.tuyaDeviceId ?? null,
                          fillerUserIds: item.fillerUserIds,
                          lampModel: item.lampModel,
                          lampLifetimeHours: item.lampLifetimeHours,
                          lampInstalledAt: item.lampInstalledAt ? item.lampInstalledAt.toISOString().slice(0, 10) : null,
                          lampUsedHours: item.lampUsedHours,
                        }}
                      />
                      {canDelete && (
                        <DeleteButton
                          id={item.id}
                          endpoint="/api/equipment"
                          entityName={t("entityName", { name: item.name })}
                          usageEndpoint={`/api/equipment/${item.id}/usage`}
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
