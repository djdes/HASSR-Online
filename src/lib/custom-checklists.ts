import { z } from "zod";
import { checklistConditionMatches, checklistConditionProblem, checklistConditionSchema, checklistHasAnswer, checklistRuleSchema, checklistScalarSchema } from "./custom-checklist-rules";

export const CHECKLIST_CODE = "custom_checklists";
export const QUESTION_TYPES = ["yes_no", "scale", "choice", "multi", "number", "checkbox", "datetime", "photo", "text", "info", "signature"] as const;
export const QUESTION_LABELS: Record<(typeof QUESTION_TYPES)[number], string> = {
  yes_no: "Да / Нет / Не применимо", scale: "Шкала", choice: "Выбор из списка", multi: "Мультивыбор", number: "Число", checkbox: "Чек-бокс", datetime: "Дата и время", photo: "Фото", text: "Текст", info: "Информация", signature: "Подпись",
};
const id = z.string().min(1).max(100);
const questionSchema = z.object({
  id, title: z.string().trim().min(1).max(300), description: z.string().max(3000).default(""),
  type: z.enum(QUESTION_TYPES), active: z.boolean().default(true), required: z.boolean().default(false),
  weight: z.number().finite().min(0).max(1000).default(1),
  min: z.number().finite().default(0), max: z.number().finite().default(10),
  options: z.array(z.object({ value: id, label: z.string().trim().min(1).max(200), score: z.number().finite().min(0).max(1).default(1), points: z.number().finite().min(0).max(1000).optional(), violation: z.boolean().optional(), excluded: z.boolean().optional() })).max(40).default([]),
  showIf: z.object({ questionId: id, value: checklistScalarSchema.optional(), operator: checklistConditionSchema.shape.operator.optional(), upper: checklistScalarSchema.optional() }).optional(),
  logic: z.array(checklistRuleSchema).max(10).optional(), violation: checklistConditionSchema.optional(),
  labels: z.object({ yes: z.string().trim().min(1).max(100), no: z.string().trim().min(1).max(100), na: z.string().trim().max(100) }).optional(),
  excludedAnswers: z.array(z.enum(["yes", "no", "na"])).max(3).optional(),
  answerPoints: z.object({ yes: z.number().finite().min(0).max(1000), no: z.number().finite().min(0).max(1000), na: z.number().finite().min(0).max(1000) }).optional(),
  unit: z.string().max(40).optional(), step: z.number().finite().positive().max(10000).optional(),
  scaleScoring: z.enum(["range", "value"]).optional(), multiScoring: z.enum(["average", "sum"]).optional(),
  minPhotos: z.number().int().min(1).max(10).optional(), references: z.array(z.string().regex(/^file:[a-zA-Z0-9_-]{8,100}$/)).max(10).optional(),
}).superRefine((question, ctx) => {
  if (question.min >= question.max) ctx.addIssue({ code: "custom", message: "Минимум должен быть меньше максимума" });
  if (["choice", "multi"].includes(question.type) && !question.options.length) ctx.addIssue({ code: "custom", message: "Добавьте варианты ответа" });
  if (new Set(question.options.map((option) => option.value)).size !== question.options.length) ctx.addIssue({ code: "custom", message: "Варианты должны иметь разные значения" });
  if (question.step && question.step > question.max - question.min) ctx.addIssue({ code: "custom", message: "Шаг не должен превышать диапазон" });
  if (question.type === "scale" && question.scaleScoring === "value" && (question.min < 0 || question.max <= 0)) ctx.addIssue({ code:"custom",message:"Для баллов по значению используйте неотрицательную шкалу с положительным максимумом" });
  if (question.violation) { const problem = checklistConditionProblem(question.violation, question.type); if (problem) ctx.addIssue({ code: "custom", message: problem }); }
  if (new Set(question.logic?.map(rule => rule.id)).size !== (question.logic?.length ?? 0)) ctx.addIssue({ code: "custom", message: "Повторяющийся идентификатор логики" });
  for (const rule of question.logic ?? []) {
    if (["photo", "text", "info", "signature"].includes(question.type)) ctx.addIssue({ code: "custom", message: "Логика настраивается для основных типов вопросов" });
    const problem = checklistConditionProblem(rule.condition, question.type); if (problem) ctx.addIssue({ code: "custom", message: problem });
  }
});
export const checklistDefinitionSchema = z.object({
  description: z.string().max(3000).default(""),
  numbering: z.boolean().optional(),
  sections: z.array(z.object({ id, title: z.string().trim().min(1).max(200), active: z.boolean().default(true), categories: z.array(z.object({ id, title: z.string().trim().min(1).max(200), active: z.boolean().default(true), repeatable: z.boolean().optional(), questions: z.array(questionSchema).max(100) })).max(30) })).min(1).max(30),
}).superRefine((definition, ctx) => {
  const seen = new Set<string>();
  const precedingQuestions = new Set<string>();
  const questionMap = new Map<string, z.infer<typeof questionSchema>>();
  const depths = new Map<string, number>();
  let count = 0;
  for (const section of definition.sections) {
    for (const node of [section, ...section.categories]) {
      if (seen.has(node.id)) ctx.addIssue({ code: "custom", message: "Повторяющийся идентификатор" });
      seen.add(node.id);
    }
    for (const category of section.categories) for (const question of category.questions) {
      count++;
      if (seen.has(question.id)) ctx.addIssue({ code: "custom", message: "Повторяющийся идентификатор вопроса" });
      if (question.showIf && !precedingQuestions.has(question.showIf.questionId)) ctx.addIssue({ code: "custom", message: "Условие должно ссылаться на предыдущий вопрос" });
      if (question.showIf) {
        const source = questionMap.get(question.showIf.questionId);
        const condition = { ...question.showIf, operator: question.showIf.operator ?? "eq" };
        const parsed = checklistConditionSchema.safeParse(condition.operator ? { operator: condition.operator, value: condition.value, upper: condition.upper } : condition);
        if (!parsed.success) ctx.addIssue({ code: "custom", message: "Проверьте условие показа вопроса" });
        else if (source) { const problem = checklistConditionProblem(parsed.data, source.type); if (problem) ctx.addIssue({ code: "custom", message: problem }); }
        const depth = (depths.get(question.showIf.questionId) ?? 0) + 1;
        depths.set(question.id, depth);
        if (depth > 3) ctx.addIssue({ code: "custom", message: "Вложенность дополнительных вопросов — до трёх уровней" });
      } else depths.set(question.id, 0);
      questionMap.set(question.id, question);
      seen.add(question.id); precedingQuestions.add(question.id);
    }
  }
  if (count > 400 || count === 0) ctx.addIssue({ code: "custom", message: "В шаблоне должно быть от 1 до 400 вопросов" });
});
export type ChecklistDefinition = z.infer<typeof checklistDefinitionSchema>;
export type ChecklistQuestion = z.infer<typeof questionSchema>;
export type ChecklistAnswer = string | number | boolean | string[];
export type ChecklistAnswers = Record<string, ChecklistAnswer>;
export const checklistAnswersSchema = z.record(z.string().min(1).max(220), z.union([z.string().max(3_000_000), z.number().finite(), z.boolean(), z.array(z.string().max(110)).max(40)])).refine((answers) => Object.keys(answers).length <= 1200 && JSON.stringify(answers).length <= 6_000_000, "Слишком большой объём ответов");

export function allChecklistQuestions(definition: ChecklistDefinition): ChecklistQuestion[] {
  return definition.sections.flatMap((section) => section.categories.flatMap((category) => category.questions));
}
export function visibleChecklistQuestions(definition: ChecklistDefinition, answers: ChecklistAnswers): ChecklistQuestion[] {
  const visibleIds = new Set<string>();
  const visible: ChecklistQuestion[] = [];
  for (const section of definition.sections) for (const category of section.categories) for (const question of category.questions) {
    if (!section.active || !category.active || !question.active) continue;
    if (question.showIf) {
      const condition = question.showIf;
      const answer = answers[condition.questionId];
      if (!visibleIds.has(condition.questionId) || !checklistConditionMatches({ operator: condition.operator ?? "eq", value: condition.value, upper: condition.upper }, answer)) continue;
    }
    visibleIds.add(question.id); visible.push(question);
  }
  return visible;
}

export function checklistAnswerProblem(question: ChecklistQuestion, value: ChecklistAnswer | undefined, completing: boolean): string | null {
  if (question.type === "info") return null;
  const empty = value === undefined || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
  if (empty) return completing && question.required ? "Обязательный вопрос" : null;
  switch (question.type) {
    case "yes_no": return typeof value === "string" && ["yes", "no", ...(question.labels?.na === "" ? [] : ["na"])].includes(value) ? null : "Выберите Да, Нет или Не применимо";
    case "checkbox": return typeof value === "boolean" ? null : "Выберите значение чек-бокса";
    case "number": case "scale": {
      if (typeof value !== "number" || !Number.isFinite(value) || value < question.min || value > question.max) return `Введите число от ${question.min} до ${question.max}`;
      if (question.step && Math.abs((value - question.min) / question.step - Math.round((value - question.min) / question.step)) > 1e-7) return `Используйте шаг ${question.step}`;
      return null;
    }
    case "choice": return typeof value === "string" && question.options.some((option) => option.value === value) ? null : "Выберите вариант из списка";
    case "multi": return Array.isArray(value) && new Set(value).size === value.length && value.every((answer) => question.options.some((option) => option.value === answer)) ? null : "Выберите варианты из списка";
    case "datetime": return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}Z`)) && new Date(`${value}Z`).toISOString().slice(0, 16) === value ? null : "Введите дату и время";
    case "text": return typeof value === "string" && value.length <= 10000 ? null : "Текст до 10 000 символов";
    case "photo": case "signature": {
      if (question.type === "photo") {
        const refs = Array.isArray(value) ? value : [value];
        if (refs.length > 0 && refs.every(ref => typeof ref === "string" && /^file:[a-zA-Z0-9_-]{8,100}$/.test(ref))) {
          if (new Set(refs).size !== refs.length) return "Одна фотография не должна повторяться";
          return completing && refs.length < (question.minPhotos ?? 1) ? `Добавьте фотографии: минимум ${question.minPhotos ?? 1}` : null;
        }
      }
      if (typeof value !== "string") return "Добавьте изображение";
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
      if (!match || match[2].length > 2_800_000) return "Изображение PNG или JPG до 2 МБ";
      const prefix = match[1] === "png" ? "iVBORw0KGgo" : "/9j/";
      if (question.type === "photo" && completing && (question.minPhotos ?? 1) > 1) return `Добавьте фотографии: минимум ${question.minPhotos}`;
      return match[2].startsWith(prefix) ? null : "Некорректное изображение";
    }
  }
}

export function validateChecklistAnswers(definition: ChecklistDefinition, answers: ChecklistAnswers, completing: boolean) {
  const knownIds = new Set(allChecklistQuestions(definition).map((question) => question.id));
  const errors: Record<string, string> = {};
  for (const key of Object.keys(answers)) if (!knownIds.has(key)) errors[key] = "Неизвестный вопрос";
  // Hidden answers may remain in a draft, so validate their shape as well.
  // Visibility controls requiredness; finalization prunes hidden values.
  for (const question of allChecklistQuestions(definition)) {
    if (answers[question.id] === undefined) continue;
    const problem = checklistAnswerProblem(question, answers[question.id], false);
    if (problem) errors[question.id] = problem;
  }
  for (const question of visibleChecklistQuestions(definition, answers)) {
    const problem = checklistAnswerProblem(question, answers[question.id], completing);
    if (problem) errors[question.id] = problem;
  }
  return errors;
}

export function checklistScore(definition: ChecklistDefinition, answers: ChecklistAnswers): { earned: number; possible: number } {
  let earned = 0; let possible = 0;
  for (const question of visibleChecklistQuestions(definition, answers)) {
    const value = answers[question.id];
    if (!checklistHasAnswer(value)) continue;
    if (question.logic?.some(rule => rule.actions.stop && rule.actions.zeroScore && checklistConditionMatches(rule.condition, value))) return { earned: 0, possible: 0 };
    if (question.type === "yes_no" && (question.excludedAnswers ?? ["na"]).includes(String(value) as "yes" | "no" | "na")) continue;
    if (["choice", "multi"].includes(question.type) && question.options.some(option => option.excluded && (Array.isArray(value) ? value.includes(option.value) : value === option.value))) continue;
    const optionPoints = (option: ChecklistQuestion["options"][number]) => option.points ?? option.score * question.weight;
    if (question.type === "yes_no" && question.answerPoints && typeof value === "string" && ["yes", "no", "na"].includes(value)) { possible += Math.max(question.weight, ...Object.values(question.answerPoints)); earned += question.answerPoints[value as "yes" | "no" | "na"]; continue; }
    if (question.type === "choice" && question.options.some(option => option.points !== undefined)) { possible += Math.max(question.weight, ...question.options.filter(option => !option.excluded).map(optionPoints)); earned += optionPoints(question.options.find(option => option.value === value) ?? { score: 0, value: "", label: "" }); continue; }
    if (question.type === "multi" && question.multiScoring === "sum" && Array.isArray(value)) { possible += question.options.filter(option => !option.excluded).reduce((sum, option) => sum + optionPoints(option), 0); earned += question.options.filter(option => value.includes(option.value)).reduce((sum, option) => sum + optionPoints(option), 0); continue; }
    if (["number", "datetime"].includes(question.type) && question.violation) { possible += question.weight; earned += checklistConditionMatches(question.violation, value) ? 0 : question.weight; continue; }
    let score: number | null = null;
    if (question.type === "yes_no") score = value === "yes" ? 1 : 0;
    if (question.type === "checkbox") score = value === true ? 1 : 0;
    if (question.type === "scale" && typeof value === "number") score = question.scaleScoring === "value" ? value / question.max : (value - question.min) / (question.max - question.min);
    if (question.type === "choice") score = question.options.find((option) => option.value === value)?.score ?? 0;
    if (question.type === "multi" && Array.isArray(value) && value.length) score = value.reduce((sum, answer) => sum + (question.options.find((option) => option.value === answer)?.score ?? 0), 0) / value.length;
    if (score !== null) { possible += question.weight; earned += Math.max(0, Math.min(1, score)) * question.weight; }
  }
  return { earned: Math.round(earned * 100) / 100, possible };
}

export function newChecklistQuestion(questionId: string): ChecklistQuestion {
  return { id: questionId, title: "Новый вопрос", description: "", type: "yes_no", active: true, required: true, weight: 1, min: 0, max: 10, options: [] };
}
