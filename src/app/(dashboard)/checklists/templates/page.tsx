import { notFound } from "next/navigation";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { canWriteJournal, hasJournalAccess } from "@/lib/journal-acl";
import { hasCapability } from "@/lib/permission-presets";
import { CHECKLIST_CODE, allChecklistQuestions, checklistDefinitionSchema } from "@/lib/custom-checklists";
import { TYPICAL_CHECKLISTS, summarizeTypicalChecklist } from "@/lib/checklist-templates";
import { assignedToUser } from "@/lib/checklist-assignments.server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { TemplatesPageClient } from "@/components/checklists/templates-page-client";

export const dynamic = "force-dynamic";

/**
 * «Чек-листы → Шаблоны» (скан 82, лист 3; 2026-10-19) — корень раздела:
 * «Назначено вам» (если есть назначения на сегодня), шесть типовых
 * чек-листов (добавить в организацию) и шаблоны организации (начать
 * проверку, изменить в конструкторе, назначить). Доступ — как у конструктора.
 */
export default async function ChecklistTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAuth();
  if (!(await hasJournalAccess(session.user, CHECKLIST_CODE))) notFound();
  const organizationId = getActiveOrgId(session);
  const params = await searchParams;
  const highlight = typeof params.assignment === "string" ? params.assignment : null;
  const now = new Date();

  const [orgTemplates, canRun, assigned] = await Promise.all([
    db.checklistTemplate.findMany({
      where: { organizationId, archived: false },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, title: true, version: true, definition: true, updatedAt: true },
    }),
    canWriteJournal(session.user, CHECKLIST_CODE),
    assignedToUser(organizationId, session.user.id, now),
  ]);

  const templates = orgTemplates.map((template) => {
    const parsed = checklistDefinitionSchema.safeParse(template.definition);
    return {
      id: template.id,
      title: template.title,
      version: template.version,
      sections: parsed.success ? parsed.data.sections.length : 0,
      questions: parsed.success ? allChecklistQuestions(parsed.data).length : 0,
    };
  });
  const byTitle = new Map(templates.map((template) => [template.title, template.id]));
  const typical = TYPICAL_CHECKLISTS.map((template) => {
    const summary = summarizeTypicalChecklist(template);
    return { ...summary, addedId: byTitle.get(summary.title) ?? null };
  });

  return (
    <DomainMessagesBoundary namespaces={["checklistPages"]}>
      <TemplatesPageClient
        typical={typical}
        templates={templates}
        assigned={assigned}
        highlightAssignmentId={highlight}
        canManage={hasCapability(session.user, "journals.manage")}
        canAssign={hasCapability(session.user, "admin.full")}
        canRun={canRun}
      />
    </DomainMessagesBoundary>
  );
}
