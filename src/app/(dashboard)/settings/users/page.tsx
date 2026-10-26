import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActiveBuildingId, listOrganizationBuildings } from "@/lib/active-building";
import { positionSuggestionOptionsFor } from "@/lib/sphere-positions";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { StaffPageClient } from "@/components/staff/staff-page-client";
import { StaffPlaceFilter } from "@/components/staff/staff-place-filter";
import { isOfficeBuilding } from "@/lib/building-scope";
import { PinRequestsPanel } from "@/components/staff/pin-requests-panel";
import { listPendingQrPinRequests } from "@/lib/qr-pin-requests";
import { AddOrganizationButton } from "@/components/settings/add-organization-button";
import { normalizeSphere } from "@/lib/org-profile";
import { ArchivedStaffSection } from "@/components/staff/archived-staff-section";
import { loadAccountBilling } from "@/lib/billing.server";
import { BILLING_PAY_HREF } from "@/lib/billing-period";
import { SEATS_PER_POINT, seatUpgradeTarget } from "@/lib/tariff-plans";
import { isMobileAppRequest } from "@/lib/mobile-app-payments";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export const dynamic = "force-dynamic";

export default async function StaffPage({
  searchParams,
}: {
  /** `place` — фильтр «Где работает» (id офиса/точки или `none`); `add` — сразу открыть добавление в это место. */
  searchParams: Promise<{ place?: string | string[]; add?: string | string[] }>;
}) {
  const query = await searchParams;
  const t = await getTranslations("settingsUi.usersPage");
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    // Non-managers don't manage staff. Push them to the generic settings hub.
    redirect("/settings");
  }

  const orgId = getActiveOrgId(session);
  const telegramBotUrl = process.env.TELEGRAM_BOT_USERNAME
    ? `https://t.me/${process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "")}`
    : null;

  const [
    organization,
    positions,
    employees,
    workOffDays,
    vacations,
    sickLeaves,
    dismissals,
    tasksflowIntegration,
  ] =
    await Promise.all([
      db.organization.findUnique({
        where: { id: orgId },
        // `type` — сфера организации (см. src/lib/org-profile.ts):
        // из неё берём подсказки типовых должностей.
        select: { id: true, name: true, type: true, perLocationJournals: true },
      }),
      db.jobPosition.findMany({
        where: { organizationId: orgId },
        orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      }),
      db.user.findMany({
        where: { organizationId: orgId, archivedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          contactEmail: true,
          phone: true,
          telegramChatId: true,
          jobPositionId: true,
          positionTitle: true,
          role: true,
          isActive: true,
          isRoot: true,
          archivedAt: true,
          weeklyDaysOff: true,
          qrPinHash: true,
          buildingIds: true,
          canEditBrakerageDishes: true,
          keepsCoreJournals: true,
          canManageSettings: true,
        },
      }),
      db.staffWorkOffDay.findMany({
        where: { user: { organizationId: orgId } },
        select: { userId: true, date: true, kind: true },
      }),
      db.staffVacation.findMany({
        where: { user: { organizationId: orgId } },
        orderBy: { dateFrom: "asc" },
        include: {
          user: { select: { name: true, jobPositionId: true, positionTitle: true, role: true } },
        },
      }),
      db.staffSickLeave.findMany({
        where: { user: { organizationId: orgId } },
        orderBy: { dateFrom: "asc" },
        include: {
          user: { select: { name: true, jobPositionId: true, positionTitle: true, role: true } },
        },
      }),
      db.staffDismissal.findMany({
        where: { user: { organizationId: orgId } },
        orderBy: { date: "desc" },
        include: {
          user: { select: { name: true, jobPositionId: true, positionTitle: true, role: true } },
        },
      }),
      // Промо TasksFlow в форме добавления сотрудника показываем только
      // тем, у кого интеграции ещё нет — подключённым рекламировать нечего.
      db.tasksFlowIntegration.findUnique({
        where: { organizationId: orgId },
        select: { id: true },
      }),
    ]);

  // Подсказки должностей — свои для каждой сферы (ресторану «Су-шеф» и
  // «Бариста», производству «Оператор линии»), минус те, что уже
  // заведены: предлагать «Повар», когда «Повар» уже есть, бессмысленно.
  const sphere = normalizeSphere(organization?.type);
  const existingPositionNames = positions.map((p) => p.name);
  // Точки: список для чипов «Точки» в диалогах сотрудника.
  const staffBuildings = await listOrganizationBuildings(orgId);
  const activeBuildingId = await getActiveBuildingId(session);

  // «Где работает» (2026-10-26): офис, точка или без места.
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const placeParam = one(query.place);
  const place =
    placeParam === "none" || staffBuildings.some((building) => building.id === placeParam) ? placeParam : null;
  const addParam = one(query.add);
  const initialAddBuilding = staffBuildings.find((building) => building.id === addParam) ?? null;
  const placeOf = (u: { buildingIds: string[] }) =>
    place === null ? true : place === "none" ? u.buildingIds.length === 0 : u.buildingIds.includes(place);
  const showPlaceFilter = organization?.perLocationJournals === true && staffBuildings.length >= 2;
  const countedStaff = employees.filter((u) => u.isActive && !u.isRoot);
  const placeOptions = staffBuildings.map((building) => ({
    id: building.id,
    name: building.name,
    office: isOfficeBuilding(building),
    count: countedStaff.filter((u) => u.buildingIds.includes(building.id)).length,
  }));

  const positionSuggestions = {
    management: positionSuggestionOptionsFor(
      sphere,
      "management",
      existingPositionNames
    ),
    staff: positionSuggestionOptionsFor(sphere, "staff", existingPositionNames),
    commission: [
      { id: "commission_member", name: "Член бракеражной комиссии" },
      { id: "commission_chair", name: "Председатель бракеражной комиссии" },
      { id: "commission_medical", name: "Медицинский работник" },
    ].filter(({ name }) => !existingPositionNames.includes(name)),
  };

  // Заводить новые точки может только владелец аккаунта: организации
  // делят тариф и лимит мест. Приглашённому руководителю кнопку даже не
  // показываем — отказ по клику выглядел бы как поломка.
  // Запросы PIN с QR-страниц: сотрудник придумал PIN, руководитель одобряет.
  const pinRequests = await listPendingQrPinRequests(orgId);

  const ownedAccount = await db.account.findUnique({
    where: { ownerUserId: session.user.id },
    select: { id: true, _count: { select: { organizations: true } } },
  });

  // «Архив»: вернуть сотрудников (в том числе после перехода на
  // бесплатный тариф). Уволенные по графику — во вкладке «Увольнения».
  const [archived, billing, inMobileApp] = await Promise.all([
    db.user.findMany({
      where: { organizationId: orgId, archivedAt: { not: null }, isRoot: false, dismissal: { is: null } },
      orderBy: [{ archivedAt: "desc" }, { name: "asc" }],
      take: 300,
      select: {
        id: true,
        name: true,
        positionTitle: true,
        archivedAt: true,
        jobPosition: { select: { name: true } },
      },
    }),
    loadAccountBilling(orgId).catch(() => null),
    isMobileAppRequest(),
  ]);
  const seatsFull =
    billing?.state.seatLimit != null && billing.state.activeUsers >= billing.state.seatLimit;
  // Места заняты — следующий тариф; у «Премиума» — больше по согласованию.
  const seatsUpgrade = billing ? seatUpgradeTarget(billing.state.tier) : null;
  const seatsUsed = billing?.state.activeUsers ?? 0;
  const seatsLimit = billing?.state.seatLimit ?? null;
  // Заметка под шапкой «Сотрудников»: в приложении WeSetup — только факт.
  const seatsBanner =
    seatsFull && seatsLimit !== null
      ? {
          text: inMobileApp
            ? t("seatsBannerApp", { used: seatsUsed, limit: seatsLimit })
            : seatsUpgrade === "standard"
              ? t("seatsBannerToStandard", { used: seatsUsed, limit: seatsLimit, seats: SEATS_PER_POINT.standard })
              : seatsUpgrade === "premium"
                ? t("seatsBannerToPremium", { used: seatsUsed, limit: seatsLimit, seats: SEATS_PER_POINT.premium })
                : t("seatsBannerContact", { used: seatsUsed, limit: seatsLimit, seats: SEATS_PER_POINT.premium }),
          action: inMobileApp
            ? null
            : seatsUpgrade
              ? {
                  kind: "pay" as const,
                  href: `${BILLING_PAY_HREF}#tariffs`,
                  label: seatsUpgrade === "standard" ? t("seatsBannerCtaStandard") : t("seatsBannerCtaPremium"),
                }
              : { kind: "contact" as const, subject: t("contactSubject"), label: t("contact") },
        }
      : null;

  return (
    <DomainMessagesBoundary namespaces={["staffManagement", "journals"]}>
    <>
    <PinRequestsPanel initial={pinRequests} />
    <StaffPageClient
      placeFilter={
        showPlaceFilter ? (
          <StaffPlaceFilter
            active={place}
            total={countedStaff.length}
            unplaced={countedStaff.filter((u) => u.buildingIds.length === 0).length}
            places={placeOptions}
          />
        ) : null
      }
      initialAdd={
        initialAddBuilding
          ? { buildingId: initialAddBuilding.id, office: isOfficeBuilding(initialAddBuilding) }
          : null
      }
      seatsBanner={seatsBanner}
      positionSuggestions={positionSuggestions}
      buildings={staffBuildings}
      perLocationJournals={organization?.perLocationJournals === true}
      activeBuildingId={activeBuildingId}
      hasTasksflowIntegration={Boolean(tasksflowIntegration)}
      organization={{
        id: organization?.id ?? orgId,
        name: organization?.name ?? t("organizationFallback"),
      }}
      telegramBotUrl={telegramBotUrl}
      positions={positions.map((p) => ({
        id: p.id,
        categoryKey: (p.categoryKey === "management" || p.categoryKey === "commission" ? p.categoryKey : "staff") as
          | "management"
          | "staff"
          | "commission",
        name: p.name,
        sortOrder: p.sortOrder,
        plannedHeadcount: p.plannedHeadcount ?? null,
      }))}
      employees={employees.filter(placeOf).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        contactEmail: u.contactEmail,
        phone: u.phone,
        jobPositionId: u.jobPositionId,
        positionTitle: u.positionTitle,
        role: u.role,
        isActive: u.isActive,
        isRoot: u.isRoot,
        isSelf: u.id === session.user.id,
        telegramLinked: Boolean(u.telegramChatId),
        weeklyDaysOff: u.weeklyDaysOff,
        buildingIds: u.buildingIds,
        hasQrPin: Boolean(u.qrPinHash),
        canEditBrakerageDishes: u.canEditBrakerageDishes,
        keepsCoreJournals: u.keepsCoreJournals,
        canManageSettings: u.canManageSettings,
      }))}
      workOffDays={workOffDays.map((w) => ({
        userId: w.userId,
        date: w.date.toISOString().slice(0, 10),
        kind: w.kind === "work" ? ("work" as const) : ("off" as const),
      }))}
      vacations={vacations.map((v) => ({
        id: v.id,
        userId: v.userId,
        userName: v.user.name,
        jobPositionId: v.user.jobPositionId,
        positionLabel: v.user.positionTitle || "—",
        positionRoleCode: v.user.positionTitle ? null : v.user.role,
        dateFrom: v.dateFrom.toISOString().slice(0, 10),
        dateTo: v.dateTo.toISOString().slice(0, 10),
      }))}
      sickLeaves={sickLeaves.map((s) => ({
        id: s.id,
        userId: s.userId,
        userName: s.user.name,
        jobPositionId: s.user.jobPositionId,
        positionLabel: s.user.positionTitle || "—",
        positionRoleCode: s.user.positionTitle ? null : s.user.role,
        dateFrom: s.dateFrom.toISOString().slice(0, 10),
        dateTo: s.dateTo.toISOString().slice(0, 10),
      }))}
      dismissals={dismissals.map((d) => ({
        id: d.id,
        userId: d.userId,
        userName: d.user.name,
        jobPositionId: d.user.jobPositionId,
        positionLabel: d.user.positionTitle || "—",
        positionRoleCode: d.user.positionTitle ? null : d.user.role,
        date: d.date.toISOString().slice(0, 10),
      }))}
    />
    <ArchivedStaffSection
      employees={archived.map((u) => ({
        id: u.id,
        name: u.name,
        position: u.jobPosition?.name?.trim() || u.positionTitle?.trim() || null,
        archivedAt: (u.archivedAt ?? new Date()).toISOString(),
      }))}
      seatsNote={
        seatsFull && billing?.state.seatLimit != null
          ? inMobileApp
            ? t("seatsBannerApp", { used: seatsUsed, limit: billing.state.seatLimit })
            : seatsUpgrade === "standard"
              ? t("seatsNote", { limit: billing.state.seatLimit, seats: SEATS_PER_POINT.standard })
              : seatsUpgrade === "premium"
                ? t("seatsNotePremium", { limit: billing.state.seatLimit, seats: SEATS_PER_POINT.premium })
                : t("seatsNoteContact", { limit: billing.state.seatLimit, seats: SEATS_PER_POINT.premium })
          : null
      }
      payHref={seatsFull && !inMobileApp && seatsUpgrade ? BILLING_PAY_HREF : null}
      payLabel={seatsUpgrade === "standard" ? t("seatsBannerCtaStandard") : t("seatsBannerCtaPremium")}
      contactSupport={seatsFull && !seatsUpgrade && !inMobileApp}
    />
    {ownedAccount ? (
      <div className="mt-6">
        <AddOrganizationButton
          currentSphere={sphere}
          currentName={organization?.name ?? ""}
          organizationsCount={ownedAccount._count.organizations}
        />
      </div>
    ) : null}
    </>
    </DomainMessagesBoundary>
  );
}
