import { allChecklistQuestions, checklistScore, validateChecklistAnswers, visibleChecklistQuestions, type ChecklistAnswers, type ChecklistDefinition, type ChecklistQuestion } from "./custom-checklists";
import { checklistConditionMatches, checklistFileId, checklistHasAnswer, checklistInstancesSchema, type ChecklistEvidence, type ChecklistInstances } from "./custom-checklist-rules";

export class ChecklistRunError extends Error { name = "ChecklistRunError"; }
export function expandChecklistDefinition(definition: ChecklistDefinition, instances: ChecklistInstances = {}): ChecklistDefinition {
  const parsed = checklistInstancesSchema.safeParse(instances);
  if (!parsed.success) throw new ChecklistRunError("Проверьте повторяемые категории");
  const categories = definition.sections.flatMap(section => section.categories);
  for (const [id, values] of Object.entries(instances)) {
    if (!categories.some(category => category.id === id && category.repeatable)) throw new ChecklistRunError("Эту категорию нельзя повторять");
    if (new Set(values).size !== values.length) throw new ChecklistRunError("Повторяющиеся экземпляры категории");
  }
  const result: ChecklistDefinition = { ...definition, sections: definition.sections.map(section => ({ ...section, categories: section.categories.flatMap(category => {
    const ids = new Set(category.questions.map(question => question.id));
    return [category, ...(instances[category.id] ?? []).map((instance, index) => ({
      ...category, id: `${category.id}@${instance}`, title: `${category.title} · ${index + 2}`,
      questions: category.questions.map(question => ({ ...question, id: `${question.id}@${instance}`, ...(question.showIf ? { showIf: { ...question.showIf, questionId: ids.has(question.showIf.questionId) ? `${question.showIf.questionId}@${instance}` : question.showIf.questionId } } : {}) })),
    }))];
  }) })) };
  const questions = allChecklistQuestions(result);
  if (questions.length > 1200 || new Set(questions.map(question => question.id)).size !== questions.length) throw new ChecklistRunError("В проверке допускается до 1200 вопросов без повторяющихся идентификаторов");
  return result;
}

export type ChecklistRequirements = { comment: boolean; photos: number; videos: number; audios: number; barcode: boolean; location: boolean };
export type ChecklistQuestionResult = { questionId: string; title: string; violation: boolean; critical: boolean; stop: boolean; zeroScore: boolean; requirements: ChecklistRequirements };
export function checklistQuestionResult(question: ChecklistQuestion, answer: unknown): ChecklistQuestionResult {
  const answered = checklistHasAnswer(answer);
  let violation = answered && (question.violation ? checklistConditionMatches(question.violation, answer)
    : question.type === "yes_no" ? answer === "no" : question.type === "checkbox" ? answer === false
      : question.options.some(option => option.violation && (Array.isArray(answer) ? answer.includes(option.value) : answer === option.value)));
  let critical = false, stop = false, zeroScore = false;
  const requirements: ChecklistRequirements = { comment: false, photos: 0, videos: 0, audios: 0, barcode: false, location: false };
  for (const rule of question.logic ?? []) {
    if (!checklistConditionMatches(rule.condition, answer)) continue;
    const action = rule.actions;
    requirements.comment ||= action.comment === true;
    requirements.photos = Math.max(requirements.photos, action.photos ?? 0);
    requirements.videos = Math.max(requirements.videos, action.videos ?? 0);
    requirements.audios = Math.max(requirements.audios, action.audios ?? 0);
    requirements.barcode ||= action.barcode === true;
    requirements.location ||= action.location === true;
    violation ||= action.violation === true || action.critical === true;
    critical ||= action.critical === true; stop ||= action.stop === true; zeroScore ||= action.stop === true && action.zeroScore === true;
  }
  return { questionId: question.id, title: question.title, violation, critical, stop, zeroScore, requirements };
}
export function evaluateChecklistRun(definition: ChecklistDefinition, answers: ChecklistAnswers) {
  const questions = visibleChecklistQuestions(definition, answers).map(question => checklistQuestionResult(question, answers[question.id]));
  return { questions, violations: questions.filter(question => question.violation), critical: questions.filter(question => question.critical), stopped: questions.some(question => question.stop), zeroScore: questions.some(question => question.zeroScore), score: checklistScore(definition, answers) };
}

export function validateChecklistRun(definition: ChecklistDefinition, answers: ChecklistAnswers, evidence: ChecklistEvidence, completing: boolean) {
  const result = evaluateChecklistRun(definition, answers);
  const errors = validateChecklistAnswers(definition, answers, completing && !result.stopped);
  const known = new Set(allChecklistQuestions(definition).map(question => question.id));
  for (const id of Object.keys(evidence)) if (!known.has(id)) errors[`${id}:evidence`] = "Подтверждение относится к неизвестному вопросу";
  for (const item of result.questions) {
    const proof = evidence[item.questionId] ?? {};
    for (const media of [proof.photos, proof.videos, proof.audios]) if (media && new Set(media).size !== media.length) errors[`${item.questionId}:evidence`] = "Не добавляйте один файл несколько раз";
    if (!completing) continue;
    const required = item.requirements;
    if (required.comment && !proof.comment?.trim()) errors[`${item.questionId}:comment`] = "Добавьте комментарий к этому ответу";
    if ((proof.photos?.length ?? 0) < required.photos) errors[`${item.questionId}:photos`] = `Добавьте фотографии: минимум ${required.photos}`;
    if ((proof.videos?.length ?? 0) < required.videos) errors[`${item.questionId}:videos`] = `Добавьте видео: минимум ${required.videos}`;
    if ((proof.audios?.length ?? 0) < required.audios) errors[`${item.questionId}:audios`] = `Добавьте аудио: минимум ${required.audios}`;
    if (required.barcode && !proof.barcode?.trim()) errors[`${item.questionId}:barcode`] = "Укажите QR-код или штрихкод";
    if (required.location && !proof.location) errors[`${item.questionId}:location`] = "Добавьте геопозицию";
  }
  return errors;
}
export function pruneChecklistRun(definition: ChecklistDefinition, answers: ChecklistAnswers, evidence: ChecklistEvidence) {
  const visible = visibleChecklistQuestions(definition, answers).filter(question => question.type !== "info");
  return {
    answers: Object.fromEntries(visible.filter(question => answers[question.id] !== undefined).map(question => [question.id, answers[question.id]])) as ChecklistAnswers,
    evidence: Object.fromEntries(visible.filter(question => evidence[question.id] !== undefined).map(question => [question.id, evidence[question.id]])) as ChecklistEvidence,
  };
}

export type ChecklistFileUse = { id: string; questionId: string; purpose: "photo" | "video" | "audio" };
export function checklistFileUses(definition: ChecklistDefinition, answers: ChecklistAnswers, evidence: ChecklistEvidence): ChecklistFileUse[] {
  const result: ChecklistFileUse[] = [];
  for (const question of allChecklistQuestions(definition)) {
    if (question.type === "photo") {
      const value = answers[question.id];
      for (const ref of Array.isArray(value) ? value : typeof value === "string" ? [value] : []) {
        const id = checklistFileId(ref); if (id) result.push({ id, questionId: question.id, purpose: "photo" });
      }
    }
    const proof = evidence[question.id];
    if (!proof) continue;
    for (const [key, purpose] of [["photos", "photo"], ["videos", "video"], ["audios", "audio"]] as const) {
      for (const ref of proof[key] ?? []) { const id = checklistFileId(ref); if (id) result.push({ id, questionId: question.id, purpose }); }
    }
  }
  return result;
}
