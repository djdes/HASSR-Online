import assert from "node:assert/strict";
import test from "node:test";
import { checklistConditionMatches, checklistConditionSchema, checklistEvidenceSchema, checklistConditionProblem } from "./custom-checklist-rules";
import { checklistDefinitionSchema, checklistScore, defaultChecklistCondition, newChecklistQuestion, visibleChecklistQuestions, type ChecklistDefinition } from "./custom-checklists";
import { evaluateChecklistRun, expandChecklistDefinition, pruneChecklistRun, resolveChecklistResult, validateChecklistRun } from "./custom-checklist-runtime";

const def = (): ChecklistDefinition => ({ description: "", sections: [{ id: "s", title: "Кухня", active: true, categories: [{ id: "c", title: "Холодильник", active: true, repeatable: true, questions: [
  { ...newChecklistQuestion("temperature"), type: "number", min: -20, max: 20 },
  { ...newChecklistQuestion("reason"), type: "text", showIf: { questionId: "temperature", operator: "gt", value: 5 } },
] }] }] });

test("choice conditions use actual options and default conditions are valid for every configurable type",()=>{
  for(const type of ["yes_no","checkbox","choice","multi","number","scale","datetime"] as const){
    const question={...newChecklistQuestion("q"),type,options:[{value:"existing",label:"Вариант",score:1}]};
    const condition=defaultChecklistCondition(question);assert.equal(checklistConditionProblem(condition,type,question.options),null);
    const definition=def();definition.sections[0].categories[0].questions=[{...question,logic:[{id:"r",condition,actions:{comment:true}}]}];assert.equal(checklistDefinitionSchema.safeParse(definition).success,true);
  }
  const definition=def();definition.sections[0].categories[0].questions=[{...newChecklistQuestion("choice"),type:"choice",options:[{value:"a",label:"А",score:1}],logic:[{id:"r",condition:{operator:"eq",value:"removed"},actions:{critical:true}}]}];
  assert.equal(checklistDefinitionSchema.safeParse(definition).success,false);
  definition.sections[0].categories[0].questions[0].logic![0].condition.value="a";assert.equal(checklistDefinitionSchema.safeParse(definition).success,true);
});
test("multiselect points average and sum omit excluded selections without erasing other answers",()=>{
  const definition=def();const question={...newChecklistQuestion("multi"),type:"multi" as const,weight:1,options:[{value:"a",label:"А",score:1,points:8},{value:"b",label:"Б",score:0.25,points:2},{value:"na",label:"Не применимо",score:1,points:1000,excluded:true}]};
  definition.sections[0].categories[0].questions=[question];
  assert.deepEqual(checklistScore(definition,{multi:["a","b","na"]}),{earned:5,possible:8});
  definition.sections[0].categories[0].questions[0].multiScoring="sum";assert.deepEqual(checklistScore(definition,{multi:["a","b","na"]}),{earned:10,possible:10});assert.deepEqual(checklistScore(definition,{multi:["na"]}),{earned:0,possible:0});
  definition.sections[0].categories[0].questions=[{...question,weight:4,multiScoring:"average",options:question.options.map(option=>({value:option.value,label:option.label,score:option.score,excluded:option.excluded}))}];assert.deepEqual(checklistScore(definition,{multi:["a","b","na"]}),{earned:2.5,possible:4});
  definition.sections[0].categories[0].questions=[{...newChecklistQuestion("one"),weight:0.1},{...newChecklistQuestion("two"),weight:0.2}];assert.deepEqual(checklistScore(definition,{one:"yes",two:"yes"}),{earned:0.3,possible:0.3});
});
test("completed results preserve the recorded score and visible questions with a legacy fallback",()=>{
  const definition=def();definition.sections[0].categories[0].questions=[{...newChecklistQuestion("first"),weight:3},{...newChecklistQuestion("follow"),type:"text",showIf:{questionId:"first",value:"no"}}];
  const recorded=evaluateChecklistRun(definition,{first:"no",follow:"Сохранённое пояснение"});
  assert.equal(recorded.questions.length,2);
  definition.sections[0].categories[0].questions[0].weight=99;
  const view=resolveChecklistResult(definition,{first:"yes"},JSON.parse(JSON.stringify(recorded)));
  assert.deepEqual(view,recorded);assert.equal(view.questions.length,2);assert.deepEqual(view.score,{earned:0,possible:3});
  assert.deepEqual(resolveChecklistResult(definition,{first:"yes"},null).score,{earned:99,possible:99});
  assert.deepEqual(resolveChecklistResult(definition,{first:"yes"},{score:{earned:NaN,possible:1}}).score,{earned:99,possible:99});
});

test("conditions distinguish absent answers from false and zero, and support inclusive ranges/date comparisons", () => {
  assert.equal(checklistConditionMatches({ operator: "any" }, false), true);
  assert.equal(checklistConditionMatches({ operator: "any" }, 0), true);
  assert.equal(checklistConditionMatches({ operator: "neq", value: "yes" }, undefined), false);
  assert.equal(checklistConditionMatches({ operator: "unchecked" }, false), true);
  assert.equal(checklistConditionMatches({ operator: "between", value: 2, upper: 5 }, 5), true);
  assert.equal(checklistConditionMatches({ operator: "not_between", value: 2, upper: 5 }, 5), false);
  assert.equal(checklistConditionMatches({ operator: "gt", value: "2026-10-15T10:00" }, "2026-10-15T10:01"), true);
  assert.equal(checklistConditionMatches({ operator: "gte", value: 2 }, ["a", "b"]), true);
  assert.equal(checklistConditionMatches({ operator: "eq", value: "a" }, ["a", "b"]), true);
  assert.equal(checklistConditionMatches({ operator: "neq", value: "a" }, ["a", "b"]), false);
  assert.equal(checklistConditionSchema.safeParse({ operator: "between", value: 0 }).success, false);
});
test("definition validates advanced conditions, type compatibility and branch depth", () => {
  assert.equal(checklistDefinitionSchema.safeParse(def()).success, true);
  const invalid = def(); invalid.sections[0].categories[0].questions[1].showIf = { questionId: "temperature", operator: "eq", value: "wrong" };
  assert.equal(checklistDefinitionSchema.safeParse(invalid).success, false);
  const deep = def();
  for (let index = 0; index < 3; index++) deep.sections[0].categories[0].questions.push({ ...newChecklistQuestion(`deep${index}`), showIf: { questionId: index ? `deep${index - 1}` : "reason", value: "yes" } });
  assert.equal(checklistDefinitionSchema.safeParse(deep).success, false);
});
test("repeatable categories remap internal conditions and keep each instance independent", () => {
  const expanded = expandChecklistDefinition(def(), { c: ["instance_2"] });
  assert.deepEqual(visibleChecklistQuestions(expanded, { temperature: 4, "temperature@instance_2": 9 }).map(question => question.id), ["temperature", "temperature@instance_2", "reason@instance_2"]);
  assert.throws(() => expandChecklistDefinition(def(), { unknown: ["instance_2"] }));
  assert.throws(() => expandChecklistDefinition(def(), { c: ["instance_2", "instance_2"] }));
  const fixed = def(); fixed.sections[0].categories[0].repeatable = false;
  assert.throws(() => expandChecklistDefinition(fixed, { c: ["instance_2"] }));
});
test("critical stop requires its evidence but does not require unrelated unanswered questions", () => {
  const definition = def();
  definition.sections[0].categories[0].questions[0].logic = [{ id: "critical", condition: { operator: "gt", value: 8 }, actions: { critical: true, stop: true, zeroScore: true, comment: true, photos: 2, location: true } }];
  const answers = { temperature: 9 };
  const errors = validateChecklistRun(definition, answers, {}, true);
  assert.equal(errors.reason, undefined);
  assert.ok(errors["temperature:comment"] && errors["temperature:photos"] && errors["temperature:location"]);
  const evidence = { temperature: { comment: "Изолировали продукт", photos: ["file:photo_123456", "file:photo_789012"], location: { latitude: 55.7, longitude: 37.6, accuracy: 10, capturedAt: "2026-10-15T10:00:00.000Z" } } };
  assert.deepEqual(validateChecklistRun(definition, answers, evidence, true), {});
  assert.equal(evaluateChecklistRun(definition, answers).stopped, true);
  assert.deepEqual(evaluateChecklistRun(definition, answers).score, { earned: 0, possible: 0 });
  assert.equal(checklistEvidenceSchema.safeParse({ temperature: { location: { ...evidence.temperature.location, latitude: 500 } } }).success, false);
  assert.ok(validateChecklistRun(definition, answers, { temperature: { ...evidence.temperature, photos: ["file:photo_123456", "file:photo_123456"] } }, true)["temperature:evidence"]);
});
test("hidden evidence is pruned and custom answer points/exclusions are honored", () => {
  const definition = def();
  assert.deepEqual(pruneChecklistRun(definition, { temperature: 4, reason: "stale" }, { reason: { comment: "stale" } }), { answers: { temperature: 4 }, evidence: {} });
  definition.sections[0].categories[0].questions = [{ ...newChecklistQuestion("q"), weight: 5, answerPoints: { yes: 5, no: 1, na: 0 }, excludedAnswers: [] }];
  assert.deepEqual(checklistScore(definition, { q: "no" }), { earned: 1, possible: 5 });
  assert.deepEqual(checklistScore(definition, { q: "na" }), { earned: 0, possible: 5 });
  definition.sections[0].categories[0].questions = [{ ...newChecklistQuestion("q"), type: "multi", multiScoring: "sum", options: [{ value: "a", label: "A", score: 1, points: 3 }, { value: "b", label: "B", score: 0, points: 2 }] }];
  assert.deepEqual(checklistScore(definition, { q: ["a"] }), { earned: 3, possible: 5 });
});
