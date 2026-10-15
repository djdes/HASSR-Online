import type { Prisma } from "@prisma/client";
import { checklistFileId } from "./custom-checklist-rules";
import { checklistFileUses } from "./custom-checklist-runtime";
import { allChecklistQuestions, type ChecklistAnswers, type ChecklistDefinition } from "./custom-checklists";
import type { ChecklistEvidence } from "./custom-checklist-rules";

export async function validateChecklistStoredFiles(db: Prisma.TransactionClient, organizationId: string, inspectionId: string, definition: ChecklistDefinition, answers: ChecklistAnswers, evidence: ChecklistEvidence): Promise<boolean> {
  const uses = checklistFileUses(definition, answers, evidence);
  if (!uses.length) return true;
  const files = await db.checklistAttachment.findMany({ where: { organizationId, inspectionId, id: { in: [...new Set(uses.map(use => use.id))] } }, select: { id: true, questionId: true, purpose: true } });
  return uses.every(use => files.some(file => file.id === use.id && file.questionId === use.questionId && file.purpose === use.purpose));
}
export async function validateChecklistReferenceFiles(db: Prisma.TransactionClient, organizationId: string, userId: string, definition: ChecklistDefinition, templateId?: string): Promise<boolean> {
  const ids = [...new Set(allChecklistQuestions(definition).flatMap(question => question.references ?? []).map(ref => checklistFileId(ref)).filter((id): id is string => !!id))];
  if (!ids.length) return true;
  const files = await db.checklistAttachment.findMany({ where: { id: { in: ids }, organizationId, purpose: "reference", OR: [{ templateId: { not: null } }, { createdById: userId }] }, select: { id: true } });
  if (files.length !== ids.length) return false;
  if (templateId) await db.checklistAttachment.updateMany({ where: { id: { in: ids }, organizationId, purpose: "reference", templateId: null, createdById: userId }, data: { templateId } });
  return true;
}
