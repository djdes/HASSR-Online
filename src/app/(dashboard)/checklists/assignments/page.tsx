import { forbidden } from "next/navigation";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { localClock } from "@/lib/checklist-assignments";
import { listAssignmentRows } from "@/lib/checklist-assignments.server";
import { loadAssignmentScope } from "@/lib/checklist-assignments.api";
import { assignmentFormInArea, assignmentRowsInArea } from "@/lib/checklist-point-scope";
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
  const { context, area } = await loadAssignmentScope(session, organizationId);
  const [templates, allRows] = await Promise.all([
    db.checklistTemplate.findMany({
      where: { organizationId, archived: false },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    listAssignmentRows(organizationId, now, context),
  ]);
  // Точка из шапки (2026-10-31) и точки руководителя точки (2026-11-01):
  // назначения на другую точку или на сотрудника другой точки здесь не
  // показываем, в форме — только точки и люди области; должность действует
  // во всей компании — руководителю точки её не предлагаем.
  const rows = assignmentRowsInArea(area, allRows);
  const form = assignmentFormInArea(area, context);
  const presetTemplate = typeof params.template === "string" && templates.some((item) => item.id === params.template) ? params.template : null;

  return (
    <DomainMessagesBoundary namespaces={["checklistPages"]}>
      <AssignmentsPageClient
        rows={rows}
        templates={templates}
        buildings={form.buildings}
        positions={form.positions.map((position) => ({ id: position.id, name: position.name }))}
        people={form.people.map((person) => ({
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
