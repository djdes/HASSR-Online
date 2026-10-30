import { forbidden } from "next/navigation";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasJournalAccess } from "@/lib/journal-acl";
import { hasCapability } from "@/lib/permission-presets";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { checklistInspectionReadWhere } from "@/lib/custom-checklists.server";
import { canReviewInspection, hasViolations, parseChecklistResultFilters, resultPeriodStart, summarizeChecklistResult } from "@/lib/checklist-results";
import { loadAssignmentContext, targetName } from "@/lib/checklist-assignments.server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { ResultsPageClient } from "@/components/checklists/results-page-client";

export const dynamic = "force-dynamic";

/**
 * «Чек-листы → Результаты» (2026-10-19): история проверок — дата, шаблон,
 * кто проводил, баллы и нарушения, статус, назначение; «Открыть», PDF и
 * «Принять результат» (проверяющий по назначению или руководитель).
 * Видимость — как у API проверок: все с `journals.manage`, иначе свои и те,
 * где человек проверяющий.
 */
export default async function ChecklistResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAuth();
  if (!(await hasJournalAccess(session.user, CHECKLIST_CODE))) forbidden();
  const organizationId = getActiveOrgId(session);
  const params = await searchParams;
  const filters = parseChecklistResultFilters(params);
  const highlight = typeof params.inspection === "string" ? params.inspection : null;
  const now = new Date();
  const since = resultPeriodStart(filters.period, now);
  const readWhere = checklistInspectionReadWhere({
    organizationId,
    canManage: hasCapability(session.user, "journals.manage"),
    userId: session.user.id,
  });

  const [rows, templateRows, organization] = await Promise.all([
    db.checklistInspection.findMany({
      where: {
        ...readWhere,
        ...(filters.templateId ? { templateId: filters.templateId } : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        title: true,
        templateId: true,
        templateVersion: true,
        status: true,
        result: true,
        createdAt: true,
        completedAt: true,
        createdByName: true,
        completedByName: true,
        reviewedAt: true,
        reviewedByName: true,
        assignment: { select: { id: true, targetKind: true, targetId: true, frequency: true, verifierUserId: true } },
      },
    }),
    // Шаблоны для фильтра — те, по которым у человека есть проверки (и архивные тоже).
    db.checklistInspection.findMany({
      where: readWhere,
      distinct: ["templateId"],
      orderBy: { templateId: "asc" },
      select: { templateId: true, template: { select: { title: true, archived: true } } },
      take: 300,
    }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]);
  const context = rows.some((row) => row.assignment) ? await loadAssignmentContext(organizationId) : null;
  const isAdmin = hasCapability(session.user, "admin.full");

  const inspections = rows
    .map((row) => {
      const summary = row.status === "completed" ? summarizeChecklistResult(row.result) : null;
      return {
        id: row.id,
        title: row.title,
        templateVersion: row.templateVersion,
        status: row.status === "completed" ? ("completed" as const) : ("draft" as const),
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        createdByName: row.createdByName,
        completedByName: row.completedByName,
        summary,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        reviewedByName: row.reviewedByName,
        assignment: row.assignment
          ? {
              targetKind: row.assignment.targetKind,
              targetName: context ? targetName(row.assignment.targetKind, row.assignment.targetId, context) : null,
              frequency: row.assignment.frequency,
              verifierIsMe: row.assignment.verifierUserId === session.user.id,
            }
          : null,
        canReview: canReviewInspection({
          status: row.status,
          reviewedAt: row.reviewedAt,
          verifierUserId: row.assignment?.verifierUserId ?? null,
          userId: session.user.id,
          isAdmin,
        }),
      };
    })
    .filter((row) => !filters.violationsOnly || hasViolations(row.summary));

  const templates = templateRows
    .map((row) => ({ id: row.templateId, title: row.template.title, archived: row.template.archived }))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));

  return (
    <DomainMessagesBoundary namespaces={["checklistPages"]}>
      <ResultsPageClient
        inspections={inspections}
        templates={templates}
        filters={filters}
        highlightId={highlight}
        timeZone={organization?.timezone || "Europe/Moscow"}
      />
    </DomainMessagesBoundary>
  );
}
