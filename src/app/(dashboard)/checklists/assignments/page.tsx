import { forbidden } from "next/navigation";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { localClock } from "@/lib/checklist-assignments";
import { listAssignmentRows, loadAssignmentContext } from "@/lib/checklist-assignments.server";
import { getViewedPointId } from "@/lib/active-building";
import { checklistAssignmentAtPoint } from "@/lib/point-filters";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { AssignmentsPageClient } from "@/components/checklists/assignments-page-client";

export const dynamic = "force-dynamic";

/**
 * «Чек-листы → Назначение» (решение раздела 7, 2026-10-19: «блок
 * администрации», только руководителю): шаблон → кому → как часто и до
 * скольки → кто проверяет → напоминание в Telegram. Без TasksFlow.
 */
export default async function ChecklistAssignmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) forbidden();
  const organizationId = getActiveOrgId(session);
  const params = await searchParams;
  const now = new Date();
  const context = await loadAssignmentContext(organizationId);
  const [templates, allRows, pointId] = await Promise.all([
    db.checklistTemplate.findMany({
      where: { organizationId, archived: false },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    listAssignmentRows(organizationId, now, context),
    getViewedPointId(session),
  ]);
  // Точка из шапки (2026-10-31): назначения на другую точку или на
  // сотрудника другой точки здесь не показываем.
  const personPoints = new Map(context.people.map((person) => [person.id, person.buildingIds]));
  const livePointIds = new Set(context.buildings.map((building) => building.id));
  const rows = allRows.filter((row) => checklistAssignmentAtPoint(row, pointId, personPoints, livePointIds));
  const presetTemplate = typeof params.template === "string" && templates.some((item) => item.id === params.template) ? params.template : null;

  return (
    <DomainMessagesBoundary namespaces={["checklistPages"]}>
      <AssignmentsPageClient
        rows={rows}
        templates={templates}
        buildings={context.buildings}
        positions={context.positions.map((position) => ({ id: position.id, name: position.name }))}
        people={context.people.map((person) => ({
          id: person.id,
          name: person.name,
          positionName: person.positionName,
          jobPositionId: person.jobPositionId,
          buildingIds: person.buildingIds,
          isActive: person.isActive,
          archivedAt: null,
          hasTelegram: !!person.telegramChatId,
          canRun: person.canRun,
          manager: person.manager,
        }))}
        currentUserId={session.user.id}
        today={localClock(now, context.timeZone)}
        presetTemplateId={presetTemplate}
      />
    </DomainMessagesBoundary>
  );
}
