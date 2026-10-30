import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, MapPin, Plus, QrCode, Thermometer } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { listOrganizationBuildings, listPersonBuildings } from "@/lib/active-building";
import { buildPlaceOptions } from "@/lib/area-building";
import { getUserDisplayTitle, isManagementRole } from "@/lib/user-roles";
import { ORG_ROSTER_WHERE, ORG_SIGNER_WHERE } from "@/lib/journal-roster";
import { UV_LAMP_TYPE, isUvLampEquipment, lampRemainingHours, lampWarnLevel } from "@/lib/uv-lamp";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { EquipmentDialog } from "@/components/settings/equipment-dialog";
import { DeleteButton } from "@/components/settings/delete-button";
import { PointBlock, PointBlockEmpty } from "@/components/settings/point-block";
import { PointDeleteBlock, PointHeadBlock, PointRoomsBlock } from "@/components/settings/point-page-client";
import { OpenAtPointButton } from "@/components/settings/open-at-point-button";
import { isOfficeBuilding } from "@/lib/building-scope";
import { isPointScoped, staffInScope } from "@/lib/point-scope";
import { expireOrgPointAssignments, loadActiveAssignments, organizationTodayKey } from "@/lib/point-assignments.server";
import { TakeSubstituteButton, type SubstituteCandidate } from "@/components/staff/point-assignment";
import { SubstituteBadge } from "@/components/staff/substitute-badge";
import { shortDateLabel } from "@/lib/point-assignments";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { readBuildingJournalSettings, withBuildingJournalSettings } from "@/lib/building-settings";
import { listAutomationCodes } from "@/lib/journal-automation";
import { readOrgCommission } from "@/lib/brakerage-commission-org";

export const dynamic = "force-dynamic";

const EQUIPMENT_TYPE_KEYS = [
  "refrigerator",
  "fridge",
  "freezer",
  "oven",
  "dishwasher",
  "scale",
  "thermometer",
  "thermohygrometer",
  "sensor",
  "fryer",
  "uv_lamp",
  "mixer",
  "other",
] as const;

function isEquipmentTypeKey(value: string): value is (typeof EQUIPMENT_TYPE_KEYS)[number] {
  return (EQUIPMENT_TYPE_KEYS as readonly string[]).includes(value);
}

/** Сколько сотрудников показать на странице точки; остальные — в «Сотрудниках». */
const POINT_STAFF_PREVIEW = 12;

const PRIMARY_LINK =
  "inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "•";
}

const OUTLINE_LINK =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Страница точки (скан 82, лист 5; 2026-10-18): ⇒ название и адрес,
 * ⇒ сотрудники точки, ⇒ журналы точки (2026-10-26: всё конкретное по
 * точке — здесь, общее — в «Моей компании»), ⇒ цеха и помещения,
 * ⇒ оборудование, ⇒ УФ-лампы, QR-наклейки, в конце — удаление. Точка —
 * пункт меню «Мои точки» раздела «Торговые точки». Права — как у «Точек»
 * (`/settings/buildings`); чужая или недоступная человеку точка — 404.
 * Офис организации — не торговая точка: его страница в «Моей компании».
 */
export default async function PointPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const { id } = await params;
  const orgId = getActiveOrgId(session);
  // Точки человека — те же, что в меню «Мои точки».
  const personBuildings = await listPersonBuildings(session);
  if (!personBuildings.some((building) => building.id === id)) notFound();
  // Срок замены вышел — вернуть людей на их точки до того, как их показать.
  await expireOrgPointAssignments(orgId);

  const [point, users, buildings, areas, orgRooms, orgEquipmentNames, staff] = await Promise.all([
    db.building.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        kind: true,
        name: true,
        address: true,
        kpp: true,
        phone: true,
        journalName: true,
        rooms: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            kind: true,
            sortOrder: true,
            cleanerUserIds: true,
            verifierUserIds: true,
            fillerUserIds: true,
            detergent: true,
            currentScope: true,
            generalScope: true,
            currentDays: true,
            generalDays: true,
            currentScheduleType: true,
            generalScheduleType: true,
            currentMonthDays: true,
            generalMonthDays: true,
            requirePhoto: true,
          },
        },
      },
    }),
    // Сотрудники для «Кто убирает / Кто проверяет» в окне помещения.
    db.user.findMany({
      where: { organizationId: orgId, isActive: true, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, isRoot: true, positionTitle: true, jobPosition: { select: { name: true } } },
    }),
    listOrganizationBuildings(orgId),
    db.area.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, buildingId: true } }),
    db.room.findMany({
      where: { building: { organizationId: orgId } },
      select: { id: true, name: true, buildingId: true, cleanerUserIds: true, verifierUserIds: true },
    }),
    db.equipment.findMany({ where: { area: { organizationId: orgId } }, select: { name: true } }),
    db.user.findMany({
      where: { organizationId: orgId, ...ORG_ROSTER_WHERE },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, positionTitle: true, canManageSettings: true, buildingIds: true, jobPosition: { select: { name: true } } },
    }),
  ]);
  if (!point) notFound();
  if (isOfficeBuilding(point)) redirect("/settings/organization/office");

  // Сотрудники точки и сводка её журналов (набор, автоматика, комиссия).
  const [pointStaff, disabledCodes, activeTemplates, orgAutomation, buildingAutomation, commission] = await Promise.all([
    db.user.findMany({
      // Все люди точки, включая бракеражную комиссию, — как в «Сотрудниках».
      where: { organizationId: orgId, ...ORG_SIGNER_WHERE, buildingIds: { has: point.id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true } } },
    }),
    getDisabledJournalCodes(orgId, point.id),
    db.journalTemplate.findMany({ where: { isActive: true }, select: { code: true } }),
    db.organization.findUnique({ where: { id: orgId }, select: { autoJournalCodes: true, journalAutomationJson: true } }),
    readBuildingJournalSettings(db, point.id),
    readOrgCommission(orgId, "finished_product", point.id),
  ]);
  // Замена (2026-10-27): кто здесь временно и кого можно взять с других точек.
  const [assignments, todayKey, orgPlaces, tAssign] = await Promise.all([
    loadActiveAssignments(orgId),
    organizationTodayKey(orgId),
    db.organization.findUnique({ where: { id: orgId }, select: { perLocationJournals: true } }),
    getTranslations("staffManagement.pointAssignment"),
  ]);
  const tradingPoints = buildings.filter((building) => !isOfficeBuilding(building));
  const canTakeSubstitute = orgPlaces?.perLocationJournals === true && tradingPoints.length >= 2;
  const officeIds = new Set(buildings.filter(isOfficeBuilding).map((building) => building.id));
  const pointName = new Map(buildings.map((building) => [building.id, building.name]));
  const substituteCandidates: SubstituteCandidate[] = canTakeSubstitute
    ? staff.flatMap((user) => {
        const known = user.buildingIds.filter((buildingId) => pointName.has(buildingId));
        // «На всех точках» уже работает и здесь; офис на точки не назначают.
        if (known.length === 0 || known.includes(point.id) || known.some((buildingId) => officeIds.has(buildingId))) return [];
        const busy = assignments.get(user.id);
        return [
          {
            id: user.id,
            name: user.name,
            position: getUserDisplayTitle(user) || null,
            pointNames: known.map((buildingId) => pointName.get(buildingId)!),
            busyUntilKey: busy ? busy.returnKey : null,
            canTransfer: staffInScope(session.user, user.buildingIds),
          },
        ];
      })
    : [];
  // Временные — первыми: их ищут глазами, и в превью из 12 они не теряются.
  const isSubstituteHere = (userId: string) => assignments.get(userId)?.buildingId === point.id;
  const orderedPointStaff = [
    ...pointStaff.filter((person) => isSubstituteHere(person.id)),
    ...pointStaff.filter((person) => !isSubstituteHere(person.id)),
  ];
  const substituteBadge = (userId: string) => {
    const assignment = assignments.get(userId);
    if (!assignment || assignment.buildingId !== point.id) return null;
    const date = shortDateLabel(assignment.returnKey);
    return (
      <SubstituteBadge
        label={tAssign("badge", { date })}
        title={
          assignment.mode === "transfer" && assignment.returnBuildingNames.length > 0
            ? tAssign("activeTransfer", { point: assignment.buildingName, date, home: assignment.returnBuildingNames.join(", ") })
            : tAssign("activeExtra", { point: assignment.buildingName, date })
        }
      />
    );
  };
  const journalsInWork = activeTemplates.filter((template) => !disabledCodes.has(template.code)).length;
  const automationCount = listAutomationCodes(withBuildingJournalSettings(orgAutomation, buildingAutomation)).filter(
    (row) => row.automation.autoCreate && !disabledCodes.has(row.code),
  ).length;

  // Оборудование точки — через цех точки (`Area.buildingId`).
  const equipment = await db.equipment.findMany({
    where: { area: { organizationId: orgId, buildingId: point.id } },
    orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
    include: { area: { select: { id: true, name: true, buildingId: true } } },
  });

  const t = await getTranslations("settingsManagement.points");
  const locale = (await getLocale()) as Locale;
  const numberFormat = new Intl.NumberFormat(FORMAT_LOCALES[locale] ?? "ru-RU", { maximumFractionDigits: 0 });
  const readOnly = session.user.partnerAccess?.level === "view";

  // Тип — код («refrigerator»); незнакомый (введён словами) — как есть.
  const typeLabel = (type: string) => {
    const key = type.trim().toLowerCase();
    return isEquipmentTypeKey(key) ? t(`equipmentTypes.${key}`) : type;
  };
  const range = (min: number | null, max: number | null) => {
    if (min !== null && max !== null) return t("equipment.rangeBoth", { min: String(min), max: String(max) });
    if (min !== null) return t("equipment.rangeFrom", { min: String(min) });
    if (max !== null) return t("equipment.rangeTo", { max: String(max) });
    return null;
  };
  const hours = (value: number) => t("uv.hours", { value: numberFormat.format(Math.round(value)) });

  const lamps = equipment.filter((item) => isUvLampEquipment(item));
  const units = equipment.filter((item) => !isUvLampEquipment(item));
  const donors = buildings
    .filter((building) => building.id !== point.id)
    .map((building) => ({
      id: building.id,
      name: building.name,
      roomsCount: orgRooms.filter((room) => room.buildingId === building.id).length,
    }))
    .filter((donor) => donor.roomsCount > 0);

  const dialog = {
    areas,
    buildings: buildings.map((building) => ({ id: building.id, name: building.name })),
    places: buildPlaceOptions({ buildings, areas, rooms: orgRooms }),
    existingNames: orgEquipmentNames.map((item) => item.name),
    fillerOptions: staff.map((user) => ({
      id: user.id,
      name: user.name,
      position: getUserDisplayTitle(user) || null,
      management: isManagementRole(user.role) || user.canManageSettings,
    })),
  };
  const editProps = (item: (typeof equipment)[number]) => ({
    ...dialog,
    equipmentBuildingId: item.area.buildingId,
    equipment: {
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
    },
  });
  const rowActions = (item: (typeof equipment)[number]) =>
    readOnly ? null : (
      <div className="flex shrink-0 items-center gap-0.5">
        <EquipmentDialog {...editProps(item)} />
        <DeleteButton
          id={item.id}
          endpoint="/api/equipment"
          entityName={`«${item.name}»`}
          usageEndpoint={`/api/equipment/${item.id}/usage`}
        />
      </div>
    );

  const hasRooms = point.rooms.length > 0;
  const stickerIds = equipment.map((item) => item.id);
  const roomIds = point.rooms.map((room) => room.id);

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement", "staffManagement"]}>
      <div className="space-y-5" data-point-page={point.id}>
        <SectionPageHeader
          title={point.name}
          description={
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4 shrink-0 text-[#9b9fb3]" />
              {point.address || t("page.noAddress")}
            </span>
          }
        />
        <PageGuide
          title={t("page.guideTitle")}
          storageKey="settings-point-v1"
          bullets={(["head", "staff", "journals", "rooms", "equipment", "qr"] as const).map((key) => ({
            title: t(`page.guide.${key}.title`),
            body: t(`page.guide.${key}.body`),
          }))}
          qa={(["allPoints", "delete"] as const).map((key) => ({ q: t(`page.qa.${key}.q`), a: t(`page.qa.${key}.a`) }))}
        />

        <PointHeadBlock
          point={{
            id: point.id,
            name: point.name,
            address: point.address,
            kpp: point.kpp,
            phone: point.phone,
            journalName: point.journalName,
          }}
          readOnly={readOnly}
        />

        <PointBlock
          number={2}
          testId="staff"
          title={t("staff.title")}
          hint={t("staff.hint")}
          action={
            <>
              {pointStaff.length > 0 ? (
                <span className="rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] font-medium tabular-nums text-[#3848c7]">
                  {t("staff.count", { count: pointStaff.length })}
                </span>
              ) : null}
              {readOnly || !canTakeSubstitute ? null : (
                <TakeSubstituteButton
                  point={{ id: point.id, name: point.name }}
                  candidates={substituteCandidates}
                  todayKey={todayKey}
                />
              )}
              {readOnly ? null : (
                <Link
                  href={`/settings/users?place=${encodeURIComponent(point.id)}&add=${encodeURIComponent(point.id)}`}
                  className={PRIMARY_LINK}
                  data-point-staff-add
                >
                  <Plus className="size-4" />
                  {t("staff.add")}
                </Link>
              )}
            </>
          }
        >
          {pointStaff.length === 0 ? (
            <PointBlockEmpty title={t("staff.emptyTitle")} body={t("staff.emptyBody")} />
          ) : (
            <div className="space-y-3">
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {orderedPointStaff.slice(0, POINT_STAFF_PREVIEW).map((person) => (
                  <li
                    key={person.id}
                    data-point-staff={person.id}
                    className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2.5"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[12.5px] font-semibold text-[#3848c7]">
                      {initialsOf(person.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-[#0b1024]">{person.name}</span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[12.5px] text-[#6f7282]">
                          {getUserDisplayTitle(person) || t("staff.noPosition")}
                        </span>
                        {substituteBadge(person.id)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <Link href={`/settings/users?place=${encodeURIComponent(point.id)}`} className={OUTLINE_LINK}>
                {pointStaff.length > POINT_STAFF_PREVIEW
                  ? t("staff.allMore", { count: pointStaff.length - POINT_STAFF_PREVIEW })
                  : t("staff.all")}
                <ArrowRight className="size-4 text-[#5566f6]" />
              </Link>
            </div>
          )}
        </PointBlock>

        <PointBlock number={3} testId="journals" title={t("journals.title")} hint={t("journals.hint")}>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["inWork", t("journals.inWork", { count: journalsInWork })],
                  ["auto", automationCount > 0 ? t("journals.auto", { count: automationCount }) : t("journals.autoOff")],
                  ["commission", commission.length > 0 ? t("journals.commission", { count: commission.length }) : t("journals.commissionNone")],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3" data-point-journals={key}>
                  <div className="text-[16px] font-semibold tabular-nums text-[#0b1024]">{value}</div>
                  <div className="mt-0.5 text-[12.5px] text-[#6f7282]">{t(`journals.${key}Hint`)}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <OpenAtPointButton buildingId={point.id} href="/dashboard" variant="primary" failedText={t("journals.failed")} testId="today">
                {t("journals.openToday")}
              </OpenAtPointButton>
              {readOnly ? null : (
                <>
                  <OpenAtPointButton buildingId={point.id} href="/settings/journals" failedText={t("journals.failed")} testId="set">
                    {t("journals.openSet")}
                  </OpenAtPointButton>
                  <OpenAtPointButton buildingId={point.id} href="/settings/auto-journals" failedText={t("journals.failed")} testId="auto">
                    {t("journals.openAuto")}
                  </OpenAtPointButton>
                  <OpenAtPointButton
                    buildingId={point.id}
                    href="/settings/brakerage-commission"
                    failedText={t("journals.failed")}
                    testId="commission"
                  >
                    {t("journals.openCommission")}
                  </OpenAtPointButton>
                </>
              )}
            </div>
          </div>
        </PointBlock>

        <PointRoomsBlock
          number={4}
          pointId={point.id}
          rooms={point.rooms}
          users={users}
          orgRooms={orgRooms}
          donors={donors}
          readOnly={readOnly}
        />

        <PointBlock
          number={5}
          testId="equipment"
          title={t("equipment.title")}
          hint={t("equipment.hint")}
          action={
            <>
              {units.length > 0 ? (
                <span className="rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] font-medium tabular-nums text-[#3848c7]">
                  {t("equipment.count", { count: units.length })}
                </span>
              ) : null}
              {readOnly || !hasRooms ? null : <EquipmentDialog {...dialog} defaultBuildingId={point.id} />}
            </>
          }
        >
          {units.length === 0 ? (
            <PointBlockEmpty
              title={t("equipment.emptyTitle")}
              body={hasRooms ? t("equipment.emptyBody") : t("equipment.noRooms")}
            />
          ) : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {units.map((item) => {
                const norm = range(item.tempMin, item.tempMax);
                return (
                  <li
                    key={item.id}
                    data-point-equipment={item.id}
                    className="flex min-w-0 items-start justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f0edff] text-[#7a5cff]">
                        <Thermometer className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="break-words text-[14.5px] font-medium text-[#0b1024]">{item.name}</div>
                        <div className="mt-0.5 text-[12.5px] leading-[1.45] text-[#6f7282]">
                          {[typeLabel(item.type), item.area.name, norm ? t("equipment.norm", { range: norm }) : t("equipment.noNorm")].join(" · ")}
                        </div>
                      </div>
                    </div>
                    {rowActions(item)}
                  </li>
                );
              })}
            </ul>
          )}
        </PointBlock>

        <PointBlock
          number={6}
          testId="uv"
          title={t("uv.title")}
          hint={t("uv.hint")}
          action={
            readOnly || !hasRooms ? null : (
              <EquipmentDialog {...dialog} defaultBuildingId={point.id} defaultType={UV_LAMP_TYPE} triggerLabel={t("uv.add")} />
            )
          }
        >
          {lamps.length === 0 ? (
            <PointBlockEmpty
              title={t("uv.emptyTitle")}
              body={hasRooms ? t("uv.emptyBody") : t("equipment.noRooms")}
            />
          ) : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {lamps.map((lamp) => {
                const life = lamp.lampLifetimeHours;
                const remaining = lampRemainingHours(life, lamp.lampUsedHours);
                const level = lampWarnLevel(life, lamp.lampUsedHours);
                const share = life && remaining !== null ? Math.max(0, Math.min(1, remaining / life)) : null;
                return (
                  <li
                    key={lamp.id}
                    data-point-lamp={lamp.id}
                    className="min-w-0 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-3"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="break-words text-[14.5px] font-medium text-[#0b1024]">{lamp.name}</div>
                        <div className="mt-0.5 text-[12.5px] leading-[1.45] text-[#6f7282]">
                          {lamp.area.name} · {t("uv.model")}: {lamp.lampModel || t("uv.noModel")}
                        </div>
                      </div>
                      {rowActions(lamp)}
                    </div>
                    {life && share !== null && remaining !== null ? (
                      <div className="mt-2.5 space-y-1.5">
                        <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[12.5px]">
                          <span className="text-[#6f7282]">
                            {t("uv.usage", { used: hours(lamp.lampUsedHours), total: hours(life) })}
                          </span>
                          <span className={level ? "font-semibold text-[#a13a32]" : "font-semibold text-[#116b2a]"}>
                            {t("uv.left", { hours: hours(remaining), percent: String(Math.round(share * 100)) })}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[#ececf4]">
                          <div
                            className={level ? "h-full bg-[#e0445a]" : "h-full bg-[#16a34a]"}
                            style={{ width: `${share * 100}%` }}
                          />
                        </div>
                        {level ? (
                          <p className="text-[12.5px] text-[#a13a32]">{level === "over" ? t("uv.over") : t("uv.warn")}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-[12.5px] text-[#a16d32]">{t("uv.noResource")}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </PointBlock>

        <PointBlock number={7} testId="qr" title={t("qr.title")} hint={t("qr.hint")}>
          {stickerIds.length === 0 && roomIds.length === 0 ? (
            <PointBlockEmpty title={t("qr.empty")}>
              <Link href="/settings/qr-posters" className={OUTLINE_LINK}>
                <QrCode className="size-4 text-[#5566f6]" />
                {t("qr.all")}
              </Link>
            </PointBlockEmpty>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
                  <div className="text-[18px] font-semibold tabular-nums text-[#0b1024]" data-point-stickers={stickerIds.length}>
                    {t("qr.stickers", { count: stickerIds.length })}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[#6f7282]">{t("qr.stickersHint")}</div>
                </div>
                <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
                  <div className="text-[18px] font-semibold tabular-nums text-[#0b1024]">
                    {t("qr.posters", { count: roomIds.length })}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[#6f7282]">{t("qr.postersHint")}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {stickerIds.length > 0 ? (
                  <Link
                    href={`/settings/qr-posters?kind=equipment&layout=sheet&ids=${stickerIds.join(",")}`}
                    data-point-qr="stickers"
                    className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  >
                    <QrCode className="size-4" />
                    {t("qr.printStickers")}
                  </Link>
                ) : null}
                {roomIds.length > 0 ? (
                  <Link
                    href={`/settings/qr-posters?kind=rooms&ids=${roomIds.join(",")}`}
                    data-point-qr="posters"
                    className={OUTLINE_LINK}
                  >
                    <QrCode className="size-4 text-[#5566f6]" />
                    {t("qr.printPosters")}
                  </Link>
                ) : null}
                <Link href="/settings/qr-posters" className={OUTLINE_LINK}>
                  {t("qr.all")}
                </Link>
              </div>
            </div>
          )}
        </PointBlock>

        {readOnly || isPointScoped(session.user) ? null : (
          <PointDeleteBlock
            point={{ id: point.id, name: point.name }}
            roomsCount={point.rooms.length}
            equipmentCount={equipment.length}
          />
        )}
      </div>
    </DomainMessagesBoundary>
  );
}
