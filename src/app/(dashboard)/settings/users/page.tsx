import { redirect } from "next/navigation";
import { getActiveBuildingId, listOrganizationBuildings } from "@/lib/active-building";
import { positionSuggestionsFor } from "@/lib/sphere-positions";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { StaffPageClient } from "@/components/staff/staff-page-client";
import { AddOrganizationButton } from "@/components/settings/add-organization-button";
import { normalizeSphere } from "@/lib/org-profile";
import type { PositionCategory } from "@/components/staff/staff-types";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
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

  const positionSuggestions: Record<PositionCategory, string[]> = {
    management: positionSuggestionsFor(
      sphere,
      "management",
      existingPositionNames
    ),
    staff: positionSuggestionsFor(sphere, "staff", existingPositionNames),
    commission: ["Член бракеражной комиссии", "Председатель бракеражной комиссии", "Медицинский работник"].filter(
      (name) => !existingPositionNames.includes(name)
    ),
  };

  // Заводить новые точки может только владелец аккаунта: организации
  // делят тариф и лимит мест. Приглашённому руководителю кнопку даже не
  // показываем — отказ по клику выглядел бы как поломка.
  const ownedAccount = await db.account.findUnique({
    where: { ownerUserId: session.user.id },
    select: { id: true, _count: { select: { organizations: true } } },
  });

  return (
    <>
    <StaffPageClient
      positionSuggestions={positionSuggestions}
      buildings={staffBuildings}
      perLocationJournals={organization?.perLocationJournals === true}
      activeBuildingId={activeBuildingId}
      hasTasksflowIntegration={Boolean(tasksflowIntegration)}
      organization={{
        id: organization?.id ?? orgId,
        name: organization?.name ?? "Организация",
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
      }))}
      employees={employees.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
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
        positionLabel: v.user.positionTitle || v.user.role || "—",
        dateFrom: v.dateFrom.toISOString().slice(0, 10),
        dateTo: v.dateTo.toISOString().slice(0, 10),
      }))}
      sickLeaves={sickLeaves.map((s) => ({
        id: s.id,
        userId: s.userId,
        userName: s.user.name,
        jobPositionId: s.user.jobPositionId,
        positionLabel: s.user.positionTitle || s.user.role || "—",
        dateFrom: s.dateFrom.toISOString().slice(0, 10),
        dateTo: s.dateTo.toISOString().slice(0, 10),
      }))}
      dismissals={dismissals.map((d) => ({
        id: d.id,
        userId: d.userId,
        userName: d.user.name,
        jobPositionId: d.user.jobPositionId,
        positionLabel: d.user.positionTitle || d.user.role || "—",
        date: d.date.toISOString().slice(0, 10),
      }))}
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
  );
}
