import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, Building2, MapPin, Plus, Refrigerator, Store } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { listOrganizationBuildings } from "@/lib/active-building";
import { isOfficeBuilding } from "@/lib/building-scope";
import { ORG_SIGNER_WHERE } from "@/lib/journal-roster";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { PointBlock, PointBlockEmpty } from "@/components/settings/point-block";
import { OpenAtPointButton } from "@/components/settings/open-at-point-button";
import { OfficeCreateButton } from "@/components/settings/office-create-button";
import { officeSetupState } from "@/lib/office-setup";
import { isOfficeLeader } from "@/lib/office-roster";

export const dynamic = "force-dynamic";

const PRIMARY_LINK =
  "inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const OUTLINE_LINK =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "•";
}

/**
 * «Моя компания → Офис» (2026-10-26): всё, что касается всей компании.
 * С 2026-11-23 (владелец: «офис — не объект»): «Руководство» — люди офиса и
 * руководство всей компании, «Показать всех сотрудников объектов» — общий
 * список с местом работы у каждого; журналы ведутся на объектах — отсюда
 * открываются журналы объекта или «Создать объект»; объекты и оборудование
 * объектов — со ссылками на полные списки. Дизайн:
 * docs/superpowers/specs/2026-10-26-office-and-points-design.md,
 * .agent/tasks/office-objects-favorites-2026-11-23/spec.md
 */
export default async function OrganizationOfficePage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) forbidden();
  const organizationId = getActiveOrgId(session);
  const readOnly = session.user.partnerAccess?.level === "view";

  const [t, org, buildings, roster, areas] = await Promise.all([
    getTranslations("settingsManagement.office"),
    db.organization.findUnique({ where: { id: organizationId }, select: { perLocationJournals: true } }),
    listOrganizationBuildings(organizationId),
    db.user.findMany({
      // Все люди, включая бракеражную комиссию, — как в «Сотрудниках».
      where: { organizationId, ...ORG_SIGNER_WHERE },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        positionTitle: true,
        buildingIds: true,
        jobPosition: { select: { name: true, categoryKey: true } },
      },
    }),
    // Оборудование объектов: сколько единиц в цехах каждого объекта.
    db.area.findMany({
      where: { organizationId },
      select: { buildingId: true, _count: { select: { equipment: true } } },
    }),
  ]);
  const office = buildings.find(isOfficeBuilding) ?? null;
  const points = buildings.filter((building) => !isOfficeBuilding(building));
  const knownIds = buildings.map((building) => building.id);
  // «Руководство»: люди офиса и руководство всей компании (2026-11-23).
  const officeStaff = roster.filter((person) => isOfficeLeader(person, office?.id ?? null, knownIds));
  const equipmentAt = (pointId: string | null) =>
    areas.filter((area) => area.buildingId === pointId).reduce((sum, area) => sum + area._count.equipment, 0);
  const looseEquipment = equipmentAt(null);
  const unplaced = roster.filter((person) => person.buildingIds.length === 0).length;
  const staffAt = (pointId: string) => roster.filter((person) => person.buildingIds.includes(pointId)).length;
  const setup = officeSetupState({
    perLocationJournals: org?.perLocationJournals === true,
    hasOffice: office !== null,
    pointCount: points.length,
  });

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
      <div className="space-y-5" data-office-page={office?.id ?? "none"}>
        <SectionPageHeader description={t("description")} />
        <PageGuide
          title={t("guide.title")}
          storageKey="settings-organization-office-v1"
          bullets={(["office", "points", "move"] as const).map((key) => ({
            title: t(`guide.${key}.title`),
            body: t(`guide.${key}.body`),
          }))}
        />

        {setup === "noPoints" ? (
          <PointBlockEmpty title={t("disabled.title")} body={t("disabled.body")}>
            <Link href="/settings/buildings" className={OUTLINE_LINK}>
              <Store className="size-4 text-[#5566f6]" />
              {t("disabled.link")}
            </Link>
          </PointBlockEmpty>
        ) : setup === "create" || !office ? (
          <section
            className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
            data-office-setup={setup}
          >
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("create.title")}</h2>
                <p className="mt-1 max-w-[560px] text-[13.5px] leading-[1.55] text-[#6f7282]">{t("create.body")}</p>
                {org?.perLocationJournals === true ? null : (
                  <ul className="mt-3 max-w-[560px] space-y-1.5 text-[13px] leading-[1.5] text-[#3c4053]" data-office-split-note>
                    {(["split", "switcher", "existing"] as const).map((key) => (
                      <li key={key} className="flex gap-2">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#5566f6]" aria-hidden />
                        <span>{t(`create.${key}`)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {readOnly ? null : <div className="mt-4"><OfficeCreateButton /></div>}
              </div>
            </div>
          </section>
        ) : (
          <>
            <PointBlock
              number={1}
              testId="office-staff"
              title={t("staff.title")}
              hint={t("staff.hint")}
              action={
                <>
                  {officeStaff.length > 0 ? (
                    <span className="rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] font-medium tabular-nums text-[#3848c7]">
                      {t("staff.count", { count: officeStaff.length })}
                    </span>
                  ) : null}
                  {readOnly ? null : (
                    <Link
                      href={`/settings/users?place=${encodeURIComponent(office.id)}&add=${encodeURIComponent(office.id)}`}
                      className={PRIMARY_LINK}
                      data-office-staff-add
                    >
                      <Plus className="size-4" />
                      {t("staff.add")}
                    </Link>
                  )}
                  <Link href="/settings/users?place=all" className={OUTLINE_LINK} data-office-staff-all>
                    {t("staff.all")}
                    <ArrowRight className="size-4 text-[#5566f6]" />
                  </Link>
                </>
              }
            >
              {officeStaff.length === 0 ? (
                <PointBlockEmpty title={t("staff.emptyTitle")} body={t("staff.emptyBody")} />
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {officeStaff.map((person) => (
                      <li
                        key={person.id}
                        data-office-staff={person.id}
                        className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2.5"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[12.5px] font-semibold text-[#3848c7]">
                          {initialsOf(person.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-medium text-[#0b1024]">{person.name}</span>
                          <span className="block truncate text-[12.5px] text-[#6f7282]">
                            {getUserDisplayTitle(person) || t("staff.noPosition")}
                          </span>
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </PointBlock>

            {/* Журналы — на объектах (владелец, 2026-11-23: офис не объект):
                кнопка объекта открывает его «Сегодня» уже с этим объектом. */}
            <PointBlock
              number={2}
              testId="office-journals"
              title={t("journals.title")}
              hint={t("journals.hint")}
            >
              <div className="flex flex-wrap items-center gap-2">
                {points.map((point) => (
                  <OpenAtPointButton
                    key={point.id}
                    buildingId={point.id}
                    href="/dashboard"
                    failedText={t("journals.failed")}
                    testId={`office-journals-${point.id}`}
                    className="max-w-full"
                  >
                    <Store className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
                    <span className="truncate">{point.name}</span>
                  </OpenAtPointButton>
                ))}
                {points.length === 0 ? (
                  <span className="text-[13.5px] text-[#6f7282]">{t("journals.empty")}</span>
                ) : null}
                {readOnly ? null : (
                  <Link href="/settings/buildings/new" className={OUTLINE_LINK} data-office-create-point>
                    <Plus className="size-4 text-[#5566f6]" />
                    {t("journals.create")}
                  </Link>
                )}
              </div>
            </PointBlock>

            <PointBlock
              number={3}
              testId="office-points"
              title={t("points.title")}
              hint={t("points.hint")}
              action={
                <>
                  {readOnly ? null : (
                    <Link href="/settings/buildings/new" className={OUTLINE_LINK}>
                      <Plus className="size-4 text-[#5566f6]" />
                      {t("points.add")}
                    </Link>
                  )}
                  <Link href="/settings/buildings" className={OUTLINE_LINK} data-office-points-all>
                    {t("points.all")}
                    <ArrowRight className="size-4 text-[#5566f6]" />
                  </Link>
                </>
              }
            >
              <div className="space-y-3">
                {unplaced > 0 ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-[#f5d9a8] bg-[#fff8eb] px-4 py-3" data-office-unplaced={unplaced}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#a16d32]" />
                    <div className="min-w-0 text-[13.5px] leading-[1.5] text-[#6b4a1f]">
                      {t("points.unplaced", { count: unplaced })}{" "}
                      <Link href="/settings/users?place=none" className="font-medium text-[#3848c7] underline-offset-2 hover:underline">
                        {t("points.unplacedLink")}
                      </Link>
                    </div>
                  </div>
                ) : null}
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {points.map((point) => (
                    <li key={point.id}>
                      <Link
                        href={`/settings/buildings/${encodeURIComponent(point.id)}`}
                        data-office-point={point.id}
                        className="group flex h-full min-w-0 flex-col gap-1 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                      >
                        <span className="flex min-w-0 items-start justify-between gap-2">
                          <span className="min-w-0 break-words text-[14.5px] font-medium text-[#0b1024]">{point.name}</span>
                          <ArrowRight className="mt-0.5 size-4 shrink-0 text-[#9b9fb3] transition-colors group-hover:text-[#5566f6]" />
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#6f7282]">
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">{point.address || t("points.noAddress")}</span>
                        </span>
                        <span className="text-[12.5px] font-medium tabular-nums text-[#3848c7]">
                          {t("points.staff", { count: staffAt(point.id) })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </PointBlock>

            {/* Оборудование объектов (2026-11-23): сколько где, полный список —
                по объектам, с переносом единицы на другой объект. */}
            <PointBlock
              number={4}
              testId="office-equipment"
              title={t("equipment.title")}
              hint={t("equipment.hint")}
              action={
                <Link href="/settings/equipment?place=all" className={OUTLINE_LINK} data-office-equipment-all>
                  {t("equipment.all")}
                  <ArrowRight className="size-4 text-[#5566f6]" />
                </Link>
              }
            >
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {points.map((point) => (
                  <li
                    key={point.id}
                    data-office-equipment-point={point.id}
                    className="flex min-w-0 items-center gap-3 rounded-2xl bg-[var(--app-veil)] px-3.5 py-2.5"
                  >
                    <Refrigerator className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#0b1024]">{point.name}</span>
                    <span className="shrink-0 text-[12.5px] font-medium tabular-nums text-[#3848c7]">
                      {t("equipment.count", { count: equipmentAt(point.id) })}
                    </span>
                  </li>
                ))}
                {looseEquipment > 0 ? (
                  <li className="flex min-w-0 items-center gap-3 rounded-2xl bg-[var(--app-veil)] px-3.5 py-2.5" data-office-equipment-loose>
                    <Refrigerator className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[#6f7282]">
                      {t("equipment.loose", { count: String(looseEquipment) })}
                    </span>
                  </li>
                ) : null}
              </ul>
            </PointBlock>
          </>
        )}
      </div>
    </DomainMessagesBoundary>
  );
}
