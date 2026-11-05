import assert from "node:assert/strict";
import test from "node:test";

import { checklistDefinitionSchema, allChecklistQuestions, validateChecklistAnswers, type ChecklistAnswers } from "@/lib/custom-checklists";
import { evaluateChecklistRun, expandChecklistDefinition, validateChecklistRun } from "@/lib/custom-checklist-runtime";
import { checklistRowKey, checklistRowQuestionId, expandChecklistRows, fillChecklistRows } from "@/lib/custom-checklist-rows";
import { applyServingDishes, mergeServingDishes } from "@/lib/serving-dishes";
import { checklistAnswerText, generateChecklistPdf } from "@/lib/custom-checklist-pdf";
import { getTypicalChecklist, summarizeTypicalChecklist, typicalChecklistCopy } from "@/lib/checklist-templates";
import { SERVING_GROUP_QUESTION_ID } from "@/lib/checklist-templates/serving-temperature";

const template = getTypicalChecklist("serving-temperature");
const dishCategoryId = template.definition.sections[1].categories[0].id;

function startInspection(dishes: ReturnType<typeof mergeServingDishes>) {
  return applyServingDishes(checklistDefinitionSchema.parse(typicalChecklistCopy("serving-temperature").definition), dishes);
}

test("шаблон проходит схему конструктора без правок, в нём категория-образец блюда", () => {
  const parsed = checklistDefinitionSchema.safeParse(template.definition);
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)));
  assert.deepEqual(parsed.data, template.definition);
  assert.equal(template.title, "Контроль температуры готовых блюд на раздаче");
  const dish = template.definition.sections[1].categories[0];
  assert.equal(dish.rowsSource, "serving_dishes");
  assert.equal(dish.rows, undefined, "у шаблона строк нет — они появляются при старте проверки");
  assert.equal(dish.questions[0].id, SERVING_GROUP_QUESTION_ID);
  assert.deepEqual(dish.questions[0].options.map((option) => option.value), ["hot", "soup", "cold", "absent"]);
  assert.equal(summarizeTypicalChecklist(template).criticalQuestions, 0);
});

test("нормы: горячее ≥ +65, первое ≥ +75, холодное ≤ +14 — по два замера на группу", () => {
  const numbers = allChecklistQuestions(template.definition).filter((question) => question.type === "number");
  assert.equal(numbers.length, 6);
  const byGroup = (value: string) => numbers.filter((question) => question.showIf?.value === value);
  assert.deepEqual(byGroup("hot").map((q) => q.violation), [{ operator: "lt", value: 65 }, { operator: "lt", value: 65 }]);
  assert.deepEqual(byGroup("soup").map((q) => q.violation), [{ operator: "lt", value: 75 }, { operator: "lt", value: 75 }]);
  assert.deepEqual(byGroup("cold").map((q) => q.violation), [{ operator: "gt", value: 14 }, { operator: "gt", value: 14 }]);
  for (const question of numbers) {
    assert.match(question.title, /в начале раздачи|через час после начала раздачи/);
    assert.equal(question.unit, "°C");
    assert.equal(question.logic?.[0]?.actions.comment, true, "вне нормы — комментарий обязателен");
  }
});

test("блюда: сначала бракераж, без повторов, подача — из справочника", () => {
  const dishes = mergeServingDishes({
    brakerage: ["Борщ", "Котлета куриная", "борщ "],
    directory: [{ name: "Салат Цезарь", servingTemp: "cold" }, { name: "БОРЩ", servingTemp: "soup" }, { name: "Компот", servingTemp: null }],
  });
  assert.deepEqual(dishes.map((dish) => [dish.title, dish.source, dish.servingTemp]), [
    ["Борщ", "brakerage", "soup"],
    ["Котлета куриная", "brakerage", null],
    ["Салат Цезарь", "directory", "cold"],
    ["Компот", "directory", null],
  ]);
  assert.equal(checklistRowKey("Борщ"), checklistRowKey("  борщ "));
  assert.equal(mergeServingDishes({ brakerage: [], directory: Array.from({ length: 80 }, (_, index) => ({ name: `Блюдо ${index}`, servingTemp: null })) }).length, 60);
});

test("старт проверки: карточка на каждое блюдо, «Как подаётся» предзаполнено", () => {
  const dishes = mergeServingDishes({ brakerage: ["Борщ"], directory: [{ name: "Борщ", servingTemp: "soup" }, { name: "Салат Цезарь", servingTemp: "cold" }, { name: "Плов", servingTemp: null }] });
  const started = startInspection(dishes);
  assert.ok(checklistDefinitionSchema.safeParse(started.definition).success, "снимок со строками проходит схему");
  const expanded = expandChecklistDefinition(started.definition);
  const titles = expanded.sections[1].categories.map((category) => category.title);
  assert.deepEqual(titles, ["Борщ", "Салат Цезарь", "Плов"]);
  const borsch = checklistRowKey("Борщ");
  assert.equal(started.answers[checklistRowQuestionId(SERVING_GROUP_QUESTION_ID, borsch)], "soup");
  assert.equal(started.answers[checklistRowQuestionId(SERVING_GROUP_QUESTION_ID, checklistRowKey("Плов"))], undefined);
  const borschQuestions = expanded.sections[1].categories[0].questions;
  assert.ok(borschQuestions.every((question) => question.title.startsWith("Борщ — ")), "в вопросе — название блюда");
  assert.ok(borschQuestions.slice(1).every((question) => question.showIf?.questionId === checklistRowQuestionId(SERVING_GROUP_QUESTION_ID, borsch)));
});

test("замеры в норме — 100 % без нарушений; вне нормы — нарушение и нужен комментарий", () => {
  const dishes = mergeServingDishes({ brakerage: [], directory: [{ name: "Борщ", servingTemp: "soup" }, { name: "Салат", servingTemp: "cold" }, { name: "Плов", servingTemp: null }] });
  const started = startInspection(dishes);
  const expanded = expandChecklistDefinition(started.definition);
  const id = (index: number, dish: string) => checklistRowQuestionId(allChecklistQuestions(template.definition)[index].id, checklistRowKey(dish));
  const questions = allChecklistQuestions(template.definition);
  const qid = (title: RegExp, group: string) => questions.find((question) => title.test(question.title) && question.showIf?.value === group)!.id;
  const good: ChecklistAnswers = {
    ...started.answers,
    [questions[1].id]: "2026-11-05T12:00",
    [checklistRowQuestionId(qid(/в начале/, "soup"), checklistRowKey("Борщ"))]: 82,
    [checklistRowQuestionId(qid(/через час/, "soup"), checklistRowKey("Борщ"))]: 76.5,
    [checklistRowQuestionId(qid(/в начале/, "cold"), checklistRowKey("Салат"))]: 6,
    [checklistRowQuestionId(qid(/через час/, "cold"), checklistRowKey("Салат"))]: 9.4,
    [id(2, "Плов")]: "absent",
  };
  assert.deepEqual(validateChecklistRun(expanded, good, {}, true), {});
  const clean = evaluateChecklistRun(expanded, good);
  assert.deepEqual(clean.violations, []);
  assert.equal(clean.score.possible, 4);
  assert.equal(clean.score.earned, 4);

  const hourLate = checklistRowQuestionId(qid(/через час/, "soup"), checklistRowKey("Борщ"));
  const bad = { ...good, [hourLate]: 61 };
  const dirty = evaluateChecklistRun(expanded, bad);
  assert.deepEqual(dirty.violations.map((item) => item.title), ["Борщ — Температура через час после начала раздачи (первое или горячий напиток)"]);
  assert.equal(dirty.score.earned, 3);
  const errors = validateChecklistRun(expanded, bad, {}, true);
  assert.deepEqual(Object.keys(errors), [`${hourLate}:comment`]);
  assert.deepEqual(validateChecklistRun(expanded, bad, { [hourLate]: { comment: "Сняли с раздачи, довели до кипения" } }, true), {});

  // Второй замер ещё не сделан: черновик сохраняется, завершить нельзя.
  const draft = { ...good }; delete draft[hourLate];
  assert.deepEqual(validateChecklistAnswers(expanded, draft, false), {});
  assert.equal(validateChecklistAnswers(expanded, draft, true)[hourLate], "Обязательный вопрос");
});

test("блюд нет — карточка-подсказка, проверку можно завершить", () => {
  const started = startInspection([]);
  const category = started.definition.sections[1].categories[0];
  assert.deepEqual(category.rows, []);
  const expanded = expandChecklistDefinition(started.definition);
  const [empty] = expanded.sections[1].categories;
  assert.equal(empty.questions.length, 1);
  assert.equal(empty.questions[0].type, "info");
  assert.match(empty.questions[0].description, /Готовая продукция/);
  assert.match(empty.questions[0].description, /бракераж/);
  const answers = { [allChecklistQuestions(template.definition)[1].id]: "2026-11-05T12:00" };
  assert.deepEqual(validateChecklistRun(expanded, answers, {}, true), {});
});

test("«Обновить список блюд»: новые — в конец, ответы по прежним остаются", () => {
  const first = startInspection(mergeServingDishes({ brakerage: ["Борщ"], directory: [] }));
  const borschGroup = checklistRowQuestionId(SERVING_GROUP_QUESTION_ID, checklistRowKey("Борщ"));
  const answers = { ...first.answers, [borschGroup]: "hot" };
  const refreshed = applyServingDishes(first.definition, mergeServingDishes({ brakerage: ["Борщ", "Плов"], directory: [{ name: "Морс", servingTemp: "cold" }] }), answers);
  assert.deepEqual(refreshed.added.map((dish) => dish.title), ["Плов", "Морс"]);
  assert.deepEqual(refreshed.definition.sections[1].categories[0].rows?.map((row) => row.title), ["Борщ", "Плов", "Морс"]);
  assert.equal(refreshed.answers[borschGroup], "hot", "ручной выбор не перетирается");
  assert.equal(refreshed.answers[checklistRowQuestionId(SERVING_GROUP_QUESTION_ID, checklistRowKey("Морс"))], "cold");
  const again = applyServingDishes(refreshed.definition, mergeServingDishes({ brakerage: ["Плов"], directory: [] }), refreshed.answers);
  assert.equal(again.added.length, 0);
});

test("строки: шаблон без rows не разворачивается, старые снимки не меняются, лимит строк", () => {
  assert.equal(expandChecklistRows(template.definition), template.definition);
  const sanpin = getTypicalChecklist("sanpin").definition;
  assert.equal(expandChecklistRows(sanpin), sanpin);
  const many = Array.from({ length: 130 }, (_, index) => ({ key: `r${index}`, title: `Блюдо ${index}` }));
  const filled = fillChecklistRows(template.definition, "serving_dishes", many);
  assert.equal(filled.definition.sections[1].categories[0].rows?.length, 100);
  assert.ok(expandChecklistDefinition(filled.definition).sections[1].categories.length === 100);
  const repeatable = structuredClone(template.definition);
  repeatable.sections[1].categories[0].repeatable = true;
  assert.equal(checklistDefinitionSchema.safeParse(repeatable).success, false, "образец со строками не бывает повторяемым");
  void dishCategoryId;
});

test("PDF проверки: блюдо, оба замера и отметка нарушения", async () => {
  const started = startInspection(mergeServingDishes({ brakerage: ["Котлета"], directory: [] }));
  const expanded = expandChecklistDefinition(started.definition);
  const questions = allChecklistQuestions(template.definition);
  const start = questions.find((q) => /в начале/.test(q.title) && q.showIf?.value === "hot")!.id;
  const hour = questions.find((q) => /через час/.test(q.title) && q.showIf?.value === "hot")!.id;
  const key = checklistRowKey("Котлета");
  const answers: ChecklistAnswers = {
    [checklistRowQuestionId(SERVING_GROUP_QUESTION_ID, key)]: "hot",
    [checklistRowQuestionId(start, key)]: 71,
    [checklistRowQuestionId(hour, key)]: 58,
  };
  const [card] = expanded.sections[1].categories;
  assert.equal(card.title, "Котлета");
  const hourQuestion = card.questions.find((question) => question.id === checklistRowQuestionId(hour, key))!;
  assert.equal(checklistAnswerText(hourQuestion, 58), "58 °C");
  assert.equal(evaluateChecklistRun(expanded, answers).violations[0]?.questionId, hourQuestion.id);
  const bytes = await generateChecklistPdf({ title: template.title, definition: expanded, answers });
  assert.ok(bytes.length > 1000);
});
