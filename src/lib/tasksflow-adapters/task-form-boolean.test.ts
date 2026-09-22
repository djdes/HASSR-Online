import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompletionValidator,
  type TaskFormSchema,
} from "@/lib/tasksflow-adapters/task-form";

const form: TaskFormSchema = {
  fields: [{ type: "boolean", key: "temperature", label: "Нет температуры выше 37 °C" }],
};

function parse(value: unknown) {
  const result = buildCompletionValidator(form).safeParse({ temperature: value });
  assert.ok(result.success, JSON.stringify(result));
  return (result.data as Record<string, unknown>).temperature;
}

/**
 * Галка в форме задачи — подпись (гигиена по форме Приложения №1).
 * Строка "false" не должна превращаться в подпись.
 */
test("галка: строки «false» / «0» / «off» — не отмечено", () => {
  assert.equal(parse("false"), false);
  assert.equal(parse("0"), false);
  assert.equal(parse("off"), false);
});

test("галка: true, «true», «on», «1» — отмечено", () => {
  assert.equal(parse(true), true);
  assert.equal(parse("true"), true);
  assert.equal(parse("on"), true);
  assert.equal(parse("1"), true);
});

test("галка: пусто — не передано", () => {
  assert.equal(parse(undefined), undefined);
  assert.equal(parse(null), null);
  assert.equal(parse(false), false);
});
