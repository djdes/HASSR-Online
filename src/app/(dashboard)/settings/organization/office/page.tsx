import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, Building2, MapPin, Plus, Store } from "lucide-react";
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
 * Сотрудники офиса (директор, бренд-шеф, территориалы) видят все точки, а
 * журналы и задачи у них только офисные; ниже — точки компании со
 * ссылками на их страницы, где всё конкретное по точке. Дизайн:
 * docs/superpowers/specs/2026-10-26-office-and-points-design.md
 */
export default async function OrganizationOfficePage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const readOnly = session.user.partnerAccess?.level === "view";

  const [t, org, buildings, roster] = await Promise.all([
    getTranslations("settingsManagement.office"),
    db.organization.findUnique({ where: { id: organizationId }, select: { perLocationJournals: true } }),
    listOrganizationBuildings(organizationId),
    db.user.findMany({
      // Все люди, включая бракеражную комиссию, — как в «Сотрудниках».
      where: { organizationId, ...ORG_SIGNER_WHERE },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, positionTitle: true, buildingIds: true, jobPosition: { select: { name: true } } },
    }),
  ]);
  const office = buildings.find(isOfficeBuilding) ?? null;
  const points = buildings.filter((building) => !isOfficeBuilding(building));
  const officeStaff = office ? roster.filter((person) => person.buildingIds.includes(office.id)) : [];
  const unplaced = roster.filter((person) => person.buildingIds.length === 0).length;
  const staffAt = (pointId: string) => roster.filter((person) => person.buildingIds.includes(pointId)).length;
  const perLocation = org?.perLocationJournals === true && points.length >= 1;

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

        {!perLocation ? (
          <PointBlockEmpty title={t("disabled.title")} body={t("disabled.body")}>
            <Link href="/settings/buildings" className={OUTLINE_LINK}>
              <Store className="size-4 text-[#5566f6]" />
              {t("disabled.link")}
            </Link>
          </PointBlockEmpty>
        ) : !office ? (
          <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("create.title")}</h2>
                <p className="mt-1 max-w-[560px] text-[13.5px] leading-[1.55] text-[#6f7282]">{t("create.body")}</p>
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
                    <Link href={`/settings/users?add=${encodeURIComponent(office.id)}`} className={PRIMARY_LINK} data-office-staff-add>
                      <Plus className="size-4" />
                      {t("staff.add")}
                    </Link>
                  )}
                </>
              }
            >
              {officeStaff.length === 0 ? (
                <PointBlockEmpty title={t("staff.emptyTitle")} body={t("staff.emptyBody")} />
              ) : (
                <div className="space-y-3">
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
                  <Link href={`/settings/users?place=${encodeURIComponent(office.id)}`} className={OUTLINE_LINK}>
                    {t("staff.all")}
                    <ArrowRight className="size-4 text-[#5566f6]" />
                  </Link>
                </div>
              )}
            </PointBlock>

            <PointBlock
              number={2}
              testId="office-journals"
              title={t("journals.title")}
              hint={t("journals.hint")}
              action={
                <OpenAtPointButton buildingId={office.id} href="/dashboard" failedText={t("journals.failed")} testId="office-today">
                  {t("journals.open")}
                </OpenAtPointButton>
              }
            />

            <PointBlock
              number={3}
              testId="office-points"
              title={t("points.title")}
              hint={t("points.hint")}
              action={
                readOnly ? null : (
                  <Link href="/settings/buildings/new" className={OUTLINE_LINK}>
                    <Plus className="size-4 text-[#5566f6]" />
                    {t("points.add")}
                  </Link>
                )
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
          </>
        )}
      </div>
    </DomainMessagesBoundary>
  );
}
