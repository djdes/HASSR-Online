import test from "node:test";
import assert from "node:assert/strict";

import { validateCompletion, type ScopeContext } from "./journal-completion-validators";

/**
 * Пошаговая инструкция больше не отменяет проверку полей журнала.
 *
 * До этой правки `pipelineCompleted: true` целиком выключал per-journal
 * валидатор: замер температуры холодильника закрывался одним тапом по
 * шагу «Возьми термометр», без единой цифры.
 */

function ctx(partial: Partial<ScopeContext>): ScopeContext {
  return {
    organizationId: "org-1",
    journalCode: "cold_equipment_control",
    // Без префикса `fridge:` валидатор не ходит в БД за нормой и
    // использует диапазон по умолчанию (-30…12).
    scopeKey: "test-scope",
    scopeLabel: "Холодильник — Утро",
    userId: "user-1",
    userName: "Иванова",
    data: {},
    ...partial,
  };
}

const allStepsDone = [
  { id: "thermometer", done: true },
  { id: "measure", done: true },
  { id: "record", done: true },
];

test("pipeline без температуры не закрывает замер холодильника", async () => {
  const result = await validateCompletion(
    ctx({ data: { pipelineCompleted: true, steps: allStepsDone } })
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.field === "temperature"),
    "должна быть ошибка про температуру"
  );
});

test("pipeline с температурой в норме проходит", async () => {
  const result = await validateCompletion(
    ctx({ data: { pipelineCompleted: true, steps: allStepsDone, temperature: 4 } })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("недоотмеченные шаги называют, сколько осталось", async () => {
  const result = await validateCompletion(
    ctx({
      data: {
        pipelineCompleted: true,
        steps: [
          { id: "a", done: true },
          { id: "b", done: false },
          { id: "c", done: false },
        ],
        temperature: 4,
      },
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /1 из 3/);
});

test("пустой список шагов не считается выполненной инструкцией", async () => {
  const result = await validateCompletion(
    ctx({ data: { pipelineCompleted: true, steps: [], temperature: 4 } })
  );
  assert.equal(result.ok, false);
});

test("температура вне нормы требует описания действий и в pipeline тоже", async () => {
  const outOfRange = await validateCompletion(
    ctx({
      data: { pipelineCompleted: true, steps: allStepsDone, temperature: 40 },
    })
  );
  assert.equal(outOfRange.ok, false);
  assert.ok(outOfRange.errors.some((e) => e.field === "correctiveAction"));

  const withAction = await validateCompletion(
    ctx({
      data: {
        pipelineCompleted: true,
        steps: allStepsDone,
        temperature: 40,
        correctiveAction: "Переставила продукты, вызвала мастера",
      },
    })
  );
  assert.equal(withAction.ok, true);
  assert.ok(withAction.sideEffects.some((e) => e.kind === "create_capa"));
});

test("бракераж в pipeline по-прежнему требует блюдо", async () => {
  const result = await validateCompletion(
    ctx({
      journalCode: "finished_product",
      data: {
        pipelineCompleted: true,
        steps: [{ id: "gather", done: true }],
      },
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === "dish"));
});

test("подсказка гигиены совпадает с подписью чек-бокса на экране", async () => {
  const result = await validateCompletion(
    ctx({ journalCode: "hygiene", data: {} })
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /Все сотрудники допущены/);
});

test("журнал без своего валидатора закрывается по отмеченным шагам", async () => {
  const result = await validateCompletion(
    ctx({
      journalCode: "cleaning",
      data: {
        pipelineCompleted: true,
        steps: [{ id: "floor", done: true }],
      },
    })
  );
  assert.equal(result.ok, true);
});
