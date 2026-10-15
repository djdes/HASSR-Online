import { z } from "zod";

export const CHECKLIST_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "between", "not_between", "any", "checked", "unchecked"] as const;
export const CHECKLIST_OPERATOR_LABELS: Record<(typeof CHECKLIST_OPERATORS)[number], string> = {
  eq: "Равно / содержит", neq: "Не равно / не содержит", gt: "Больше", gte: "Больше или равно", lt: "Меньше", lte: "Меньше или равно", between: "Между включительно", not_between: "Вне диапазона", any: "Любой ответ", checked: "Отмечен", unchecked: "Не отмечен",
};
export const checklistScalarSchema = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
export const checklistConditionSchema = z.object({
  operator: z.enum(CHECKLIST_OPERATORS), value: checklistScalarSchema.optional(), upper: checklistScalarSchema.optional(),
}).strict().superRefine((condition, ctx) => {
  if (!["any", "checked", "unchecked"].includes(condition.operator) && condition.value === undefined) ctx.addIssue({ code: "custom", message: "Укажите значение условия" });
  if (["between", "not_between"].includes(condition.operator) && condition.upper === undefined) ctx.addIssue({ code: "custom", message: "Укажите обе границы диапазона" });
});
export type ChecklistCondition = z.infer<typeof checklistConditionSchema>;
export const checklistRuleSchema = z.object({
  id: z.string().min(1).max(100), condition: checklistConditionSchema,
  actions: z.object({
    comment: z.boolean().optional(), photos: z.number().int().min(0).max(10).optional(),
    videos: z.number().int().min(0).max(3).optional(), audios: z.number().int().min(0).max(3).optional(),
    barcode: z.boolean().optional(), location: z.boolean().optional(), violation: z.boolean().optional(),
    critical: z.boolean().optional(), stop: z.boolean().optional(), zeroScore: z.boolean().optional(),
  }).strict(),
}).strict().superRefine((rule, ctx) => {
  if (rule.actions.zeroScore && !rule.actions.stop) ctx.addIssue({ code: "custom", message: "Обнуление результата требует завершения проверки" });
  if (rule.actions.stop && !rule.actions.critical) ctx.addIssue({ code: "custom", message: "Досрочное завершение требует критического нарушения" });
});
export type ChecklistRule = z.infer<typeof checklistRuleSchema>;

export function checklistHasAnswer(answer: unknown): boolean {
  return answer !== undefined && answer !== null && (typeof answer !== "string" || answer.trim() !== "") && (!Array.isArray(answer) || answer.length > 0);
}
function comparable(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const date = Date.parse(value + "Z");
    if (Number.isFinite(date) && new Date(date).toISOString().slice(0, 16) === value) return date;
  }
  return null;
}
export function checklistConditionMatches(condition: ChecklistCondition, answer: unknown): boolean {
  if (!checklistHasAnswer(answer)) return false;
  if (condition.operator === "any") return true;
  if (condition.operator === "checked") return answer === true;
  if (condition.operator === "unchecked") return answer === false;
  const equal = Array.isArray(answer)
    ? typeof condition.value === "number" ? answer.length === condition.value : answer.includes(condition.value)
    : answer === condition.value;
  if (condition.operator === "eq") return equal;
  if (condition.operator === "neq") return !equal;
  const value = comparable(Array.isArray(answer) ? answer.length : answer);
  const lower = comparable(condition.value), upper = comparable(condition.upper);
  if (value === null || lower === null) return false;
  switch (condition.operator) {
    case "gt": return value > lower;
    case "gte": return value >= lower;
    case "lt": return value < lower;
    case "lte": return value <= lower;
    case "between": return upper !== null && lower <= upper && value >= lower && value <= upper;
    case "not_between": return upper !== null && lower <= upper && (value < lower || value > upper);
  }
  return false;
}

export function checklistConditionProblem(condition: ChecklistCondition, type: string, options?: readonly {value:string}[]): string | null {
  if (["any", "eq", "neq"].includes(condition.operator)) {
    if (condition.operator === "any") return null;
    if (["number", "scale"].includes(type) && typeof condition.value !== "number") return "Для числового вопроса укажите число";
    if (type === "checkbox" && typeof condition.value !== "boolean") return "Для чек-бокса укажите Да или Нет";
    if (type === "yes_no" && !["yes","no","na"].includes(String(condition.value))) return "Выберите Да, Нет или Не применимо";
    if (type === "choice" && (typeof condition.value !== "string" || (options && !options.some(option=>option.value===condition.value)))) return "Выберите существующий вариант ответа для условия";
    if (type === "multi" && (typeof condition.value === "number" ? !Number.isInteger(condition.value) || condition.value < 0 : typeof condition.value !== "string" || (options && !options.some(option=>option.value===condition.value)))) return "Укажите количество вариантов или существующий вариант ответа";
    if (type === "text" && typeof condition.value !== "string") return "Для текстового ответа укажите текст условия";
    if (type === "datetime" && (typeof condition.value !== "string" || comparable(condition.value) === null)) return "Укажите корректную дату и время";
    return null;
  }
  if (["checked", "unchecked"].includes(condition.operator)) return type === "checkbox" ? null : "Это условие применяется к чек-боксу";
  if (!["number", "scale", "datetime", "multi"].includes(type)) return "Сравнение и диапазон доступны для чисел, даты и количества выбранных вариантов";
  if (type === "datetime" && (typeof condition.value !== "string" || (["between","not_between"].includes(condition.operator) && typeof condition.upper !== "string"))) return "Укажите дату и время для границ условия";
  if (type !== "datetime" && typeof condition.value !== "number") return "Укажите числовую границу";
  if (comparable(condition.value) === null) return "Некорректная граница условия";
  if (["between", "not_between"].includes(condition.operator)) {
    if (type !== "datetime" && typeof condition.upper !== "number") return "Укажите числовую верхнюю границу";
    const low = comparable(condition.value), high = comparable(condition.upper);
    if (low === null || high === null || low > high) return "Проверьте порядок границ диапазона";
  }
  return null;
}

const fileRef = z.string().regex(/^file:[a-zA-Z0-9_-]{8,100}$/);
export const checklistEvidenceItemSchema = z.object({
  comment: z.string().max(3000).optional(), photos: z.array(fileRef).max(10).optional(),
  videos: z.array(fileRef).max(3).optional(), audios: z.array(fileRef).max(3).optional(),
  barcode: z.string().max(1000).optional(),
  location: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracy: z.number().finite().min(0).max(100000), capturedAt: z.iso.datetime() }).strict().optional(),
}).strict();
export const checklistEvidenceSchema = z.record(z.string().min(1).max(220), checklistEvidenceItemSchema).refine(value => Object.keys(value).length <= 1200, "Слишком много подтверждений");
export type ChecklistEvidenceItem = z.infer<typeof checklistEvidenceItemSchema>;
export type ChecklistEvidence = z.infer<typeof checklistEvidenceSchema>;
export const checklistInstancesSchema = z.record(z.string().min(1).max(100), z.array(z.string().regex(/^[a-zA-Z0-9_-]{8,40}$/)).max(20)).refine(value => Object.keys(value).length <= 100, "Слишком много повторяемых категорий");
export type ChecklistInstances = z.infer<typeof checklistInstancesSchema>;
export function checklistFileId(value: string): string | null { return /^file:[a-zA-Z0-9_-]{8,100}$/.test(value) ? value.slice(5) : null; }
