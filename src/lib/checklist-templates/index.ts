/**
 * Типовые шаблоны чек-листов (эскиз руководителя, скан 82, лист 3).
 *
 * Шесть проверок раздела «Чек-листы»: соответствие СанПиН, принципам ХАССП,
 * проверка территориального управляющего, главного технолога, подготовка к
 * проверке Роспотребнадзора и аудит группы ХАССП. Организация получает
 * независимую копию в `ChecklistTemplate` и правит её в конструкторе —
 * типовой шаблон от этого не меняется.
 */
import { allChecklistQuestions } from "@/lib/custom-checklists";
import { TYPICAL_CHECKLIST_KEYS, type TypicalChecklistKey, type TypicalChecklistTemplate } from "./builder";
import { CHIEF_TECHNOLOGIST_CHECKLIST } from "./chief-technologist";
import { HACCP_AUDIT_CHECKLIST } from "./haccp-audit";
import { HACCP_CHECKLIST } from "./haccp";
import { ROSPOTREBNADZOR_PREP_CHECKLIST } from "./rospotrebnadzor-prep";
import { SANPIN_CHECKLIST } from "./sanpin";
import { TERRITORIAL_MANAGER_CHECKLIST } from "./territorial-manager";

export { TYPICAL_CHECKLIST_KEYS, type TypicalChecklistKey, type TypicalChecklistTemplate } from "./builder";

/** В порядке эскиза. */
export const TYPICAL_CHECKLISTS: readonly TypicalChecklistTemplate[] = [
  SANPIN_CHECKLIST,
  HACCP_CHECKLIST,
  TERRITORIAL_MANAGER_CHECKLIST,
  CHIEF_TECHNOLOGIST_CHECKLIST,
  ROSPOTREBNADZOR_PREP_CHECKLIST,
  HACCP_AUDIT_CHECKLIST,
];

export function isTypicalChecklistKey(value: unknown): value is TypicalChecklistKey {
  return typeof value === "string" && (TYPICAL_CHECKLIST_KEYS as readonly string[]).includes(value);
}

export function getTypicalChecklist(key: TypicalChecklistKey): TypicalChecklistTemplate {
  const template = TYPICAL_CHECKLISTS.find((item) => item.key === key);
  if (!template) throw new Error(`Нет типового чек-листа ${key}`);
  return template;
}

export type TypicalChecklistSummary = {
  key: TypicalChecklistKey;
  title: string;
  summary: string;
  basis: string;
  sections: number;
  questions: number;
  /** Пункты, ответ на которые может дать критическое нарушение. */
  criticalQuestions: number;
};

/** Ответы, на которых вопрос может стать критическим нарушением. */
function canBeCritical(question: ReturnType<typeof allChecklistQuestions>[number]): boolean {
  return (question.logic ?? []).some((rule) => rule.actions.critical === true);
}

export function summarizeTypicalChecklist(template: TypicalChecklistTemplate): TypicalChecklistSummary {
  const questions = allChecklistQuestions(template.definition);
  return {
    key: template.key,
    title: template.title,
    summary: template.summary,
    basis: template.basis,
    sections: template.definition.sections.length,
    questions: questions.length,
    criticalQuestions: questions.filter(canBeCritical).length,
  };
}

/** Независимая копия определения — то, что ложится в `ChecklistTemplate.definition`. */
export function typicalChecklistCopy(key: TypicalChecklistKey): { title: string; definition: TypicalChecklistTemplate["definition"] } {
  const template = getTypicalChecklist(key);
  return { title: template.title, definition: structuredClone(template.definition) };
}
