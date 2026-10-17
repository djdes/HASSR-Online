import assert from "node:assert/strict";
import test from "node:test";

import { checklistConditionMatches } from "@/lib/custom-checklist-rules";
import { evaluateChecklistRun } from "@/lib/custom-checklist-runtime";
import {
  allChecklistQuestions,
  checklistDefinitionSchema,
  type ChecklistAnswers,
  type ChecklistQuestion,
} from "@/lib/custom-checklists";
import {
  TYPICAL_CHECKLISTS,
  TYPICAL_CHECKLIST_KEYS,
  getTypicalChecklist,
  isTypicalChecklistKey,
  summarizeTypicalChecklist,
  typicalChecklistCopy,
} from "@/lib/checklist-templates";

const answerable = (question: ChecklistQuestion) => question.type !== "info";

/** Ответ «всё в норме» для вопроса любого типа. */
function goodAnswer(question: ChecklistQuestion): ChecklistAnswers[string] | undefined {
  switch (question.type) {
    case "yes_no": return "yes";
    case "checkbox": return true;
    case "scale": return question.max;
    case "choice": {
      const best = [...question.options].filter((o) => !o.violation && !o.excluded).sort((a, b) => b.score - a.score)[0];
      return best?.value;
    }
    case "multi": return question.options.filter((o) => !o.violation && !o.excluded).map((o) => o.value);
    case "number": {
      const step = question.step ?? 1;
      for (let value = question.min; value <= question.max; value = Math.round((value + step) * 1e6) / 1e6) {
        if (!question.violation || !checklistConditionMatches(question.violation, value)) return value;
      }
      return undefined;
    }
    case "datetime": return "2026-10-17T10:00";
    case "text": return "Замечаний нет";
    default: return undefined; // info, photo, signature — без ответа в расчёте
  }
}

/** Ответ «нарушение»: «Нет», вариант-нарушение, значение вне нормы. */
function badAnswer(question: ChecklistQuestion): ChecklistAnswers[string] | undefined {
  switch (question.type) {
    case "yes_no": return "no";
    case "checkbox": return false;
    case "choice": return question.options.find((o) => o.violation)?.value;
    case "number": {
      const step = question.step ?? 1;
      for (let value = question.min; value <= question.max; value = Math.round((value + step) * 1e6) / 1e6) {
        if (question.violation && checklistConditionMatches(question.violation, value)) return value;
      }
      return undefined;
    }
    default: return goodAnswer(question);
  }
}

test("шесть типовых шаблонов в порядке эскиза, ключи и названия уникальны", () => {
  assert.deepEqual(TYPICAL_CHECKLISTS.map((t) => t.key), [...TYPICAL_CHECKLIST_KEYS]);
  assert.equal(new Set(TYPICAL_CHECKLISTS.map((t) => t.title)).size, TYPICAL_CHECKLISTS.length);
  for (const key of TYPICAL_CHECKLIST_KEYS) {
    assert.ok(isTypicalChecklistKey(key));
    assert.equal(getTypicalChecklist(key).key, key);
  }
  assert.equal(isTypicalChecklistKey("unknown"), false);
  assert.equal(isTypicalChecklistKey(42), false);
});

for (const template of TYPICAL_CHECKLISTS) {
  test(`«${template.title}» проходит валидацию конструктора и содержит 25–60 вопросов`, () => {
    const parsed = checklistDefinitionSchema.safeParse(template.definition);
    assert.ok(parsed.success, `${template.key}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`);
    // Валидация не должна ничего «доправлять» — шаблон уже в итоговом виде.
    assert.deepEqual(parsed.data, template.definition, `${template.key}: схема изменила определение`);

    const questions = allChecklistQuestions(template.definition).filter(answerable);
    assert.ok(questions.length >= 25 && questions.length <= 60, `${template.key}: ${questions.length} вопросов`);

    assert.ok(template.title.length > 0 && template.title.length <= 200, template.key);
    assert.match(template.title, /\p{Script=Cyrillic}/u, template.key);
    assert.ok(template.summary.trim().length >= 20, `${template.key}: нет описания`);
    assert.ok(template.basis.trim().length >= 5, `${template.key}: нет основания`);
    assert.ok(template.definition.description.trim().length >= 20, `${template.key}: нет описания шаблона`);

    // Структура: разделы → категории → вопросы, без пустых веток.
    assert.ok(template.definition.sections.length >= 3, `${template.key}: меньше трёх разделов`);
    for (const section of template.definition.sections) {
      assert.ok(section.categories.length > 0, `${template.key}/${section.title}: пустой раздел`);
      for (const category of section.categories) {
        assert.ok(category.questions.length > 0, `${template.key}/${category.title}: пустая категория`);
      }
    }

    // Разные типы ответов, баллы и критичные пункты.
    const types = new Set(questions.map((q) => q.type));
    assert.ok(types.size >= 4, `${template.key}: типов ответов ${[...types].join(", ")}`);
    assert.ok(questions.some((q) => q.weight > 1), `${template.key}: все пункты одного веса`);
    const summary = summarizeTypicalChecklist(template);
    assert.ok(summary.criticalQuestions >= 1, `${template.key}: нет критичных пунктов`);
    assert.ok(summary.criticalQuestions <= Math.ceil(questions.length / 2), `${template.key}: критичных больше половины`);
    for (const question of questions) {
      assert.ok(question.title.trim().length >= 5, `${template.key}: короткий вопрос «${question.title}»`);
      assert.ok(!/\s{2,}/.test(question.title), `${template.key}: двойной пробел в «${question.title}»`);
    }
  });

  test(`«${template.title}»: проверка без нарушений — 100 %, с нарушениями — есть критические`, () => {
    const questions = allChecklistQuestions(template.definition);
    const good: ChecklistAnswers = {};
    const bad: ChecklistAnswers = {};
    for (const question of questions) {
      const ok = goodAnswer(question);
      if (ok !== undefined) good[question.id] = ok;
      const ko = badAnswer(question);
      if (ko !== undefined) bad[question.id] = ko;
    }
    const clean = evaluateChecklistRun(template.definition, good);
    assert.deepEqual(clean.violations.map((v) => v.title), [], `${template.key}: нарушения при ответах «в норме»`);
    assert.ok(clean.score.possible > 0, template.key);
    assert.equal(clean.score.earned, clean.score.possible, `${template.key}: не 100 % при ответах «в норме»`);

    const dirty = evaluateChecklistRun(template.definition, bad);
    assert.ok(dirty.violations.length >= 10, `${template.key}: мало нарушений`);
    assert.ok(dirty.critical.length >= 1, `${template.key}: нет критических нарушений`);
    assert.equal(dirty.stopped, false, `${template.key}: типовой шаблон не должен обрывать проверку`);
    assert.ok(dirty.score.earned < clean.score.earned, template.key);
  });
}

test("копия для организации независима от типового шаблона", () => {
  const copy = typicalChecklistCopy("sanpin");
  assert.equal(copy.title, getTypicalChecklist("sanpin").title);
  copy.definition.sections[0].title = "Изменено в организации";
  assert.notEqual(getTypicalChecklist("sanpin").definition.sections[0].title, "Изменено в организации");
});
