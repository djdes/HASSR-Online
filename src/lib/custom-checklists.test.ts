import assert from "node:assert/strict";
import test from "node:test";
import { checklistAnswerProblem, checklistDefinitionSchema, checklistScore, newChecklistQuestion, validateChecklistAnswers, visibleChecklistQuestions, type ChecklistDefinition } from "./custom-checklists";

const first = { ...newChecklistQuestion("first"), title: "Температура в норме?", weight: 3 };
const follow = { ...newChecklistQuestion("follow"), type: "text" as const, showIf: { questionId: "first", value: "no" } };
const definition = (): ChecklistDefinition => ({ description: "", sections: [{ id: "section", title: "Кухня", active: true, categories: [{ id: "category", title: "Контроль", active: true, questions: [structuredClone(first), structuredClone(follow)] }] }] });

test("conditional required answers only block completion when visible", () => {
  const def = definition();
  assert.deepEqual(visibleChecklistQuestions(def, { first: "yes" }).map((q) => q.id), ["first"]);
  assert.deepEqual(validateChecklistAnswers(def, { first: "yes" }, true), {});
  assert.equal(validateChecklistAnswers(def, { first: "no" }, true).follow, "Обязательный вопрос");
  assert.deepEqual(validateChecklistAnswers(def, { first: "no" }, false), {});
  assert.deepEqual(validateChecklistAnswers(def, { first: "no", follow: "Проверено" }, true), {});
});
test("hidden parents and stale hidden answers do not expose downstream questions", () => {
  const def = definition();
  def.sections[0].categories[0].questions.push({ ...newChecklistQuestion("third"), showIf: { questionId: "follow", value: "x" } });
  assert.deepEqual(visibleChecklistQuestions(def, { first: "yes", follow: "x" }).map((q) => q.id), ["first"]);
  def.sections[0].active = false;
  assert.deepEqual(visibleChecklistQuestions(def, { first: "no", follow: "x" }), []);
});
test("definition rejects duplicate ids, forward conditions, invalid scales and empty select options", () => {
  const def = definition(); assert.equal(checklistDefinitionSchema.safeParse(def).success, true);
  def.sections[0].categories[0].questions[1].id = "first";
  assert.equal(checklistDefinitionSchema.safeParse(def).success, false);
  const forward = definition(); forward.sections[0].categories[0].questions[0].showIf = { questionId: "follow", value: "x" };
  assert.equal(checklistDefinitionSchema.safeParse(forward).success, false);
  const bad = definition(); bad.sections[0].categories[0].questions[0].type = "choice";
  assert.equal(checklistDefinitionSchema.safeParse(bad).success, false);
});
test("required false and zero are valid answers; range and unknown ids are enforced", () => {
  assert.equal(checklistAnswerProblem({ ...first, type: "checkbox" }, false, true), null);
  assert.equal(checklistAnswerProblem({ ...first, type: "number" }, 0, true), null);
  assert.notEqual(checklistAnswerProblem({ ...first, type: "number" }, 11, true), null);
  assert.equal(validateChecklistAnswers(definition(), { injected: "yes" }, false).injected, "Неизвестный вопрос");
});
test("weighted score excludes N/A and hidden questions", () => {
  const def = definition(); def.sections[0].categories[0].questions.push({ ...newChecklistQuestion("second"), weight: 2 });
  assert.deepEqual(checklistScore(def, { first: "yes", second: "no" }), { earned: 3, possible: 5 });
  assert.deepEqual(checklistScore(def, { first: "na", second: "yes" }), { earned: 2, possible: 2 });
});
test("photo/signature fields reject URLs and HTML pretending to be an image", () => {
  const photo = { ...first, type: "photo" as const };
  assert.notEqual(checklistAnswerProblem(photo, "https://example.com/image.png", true), null);
  assert.notEqual(checklistAnswerProblem(photo, "data:text/html;base64,PHNjcmlwdD4=", true), null);
  const def = definition();
  def.sections[0].categories[0].questions[1].type = "photo";
  assert.ok(validateChecklistAnswers(def, { first: "yes", follow: "https://example.com/tracking.png" }, false).follow);
});
test("required whitespace, impossible dates and a list passed as yes/no are rejected", () => {
  assert.notEqual(checklistAnswerProblem(follow, "   ", true), null);
  assert.notEqual(checklistAnswerProblem({ ...first, type: "datetime" }, "2026-02-31T09:00", true), null);
  assert.notEqual(checklistAnswerProblem(first, ["yes"], true), null);
  assert.equal(checklistAnswerProblem({ ...first, type: "datetime" }, "2026-10-14T09:00", true), null);
});
