import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompletionValidator,
  type TaskFormSchema,
} from "@/lib/tasksflow-adapters/task-form";

const requiredTime: TaskFormSchema = {
  fields: [{ type: "time", key: "washTime", label: "Время", required: true }],
};

const optionalTime: TaskFormSchema = {
  fields: [{ type: "time", key: "arrivalTime", label: "Время приёмки" }],
};

test("время: ЧЧ:ММ проходит и остаётся строкой того же формата", () => {
  const parsed = buildCompletionValidator(requiredTime).parse({ washTime: "14:30" });
  assert.equal(parsed.washTime, "14:30");
  // Полночь и конец суток — граничные значения.
  assert.equal(
    buildCompletionValidator(requiredTime).parse({ washTime: "00:00" }).washTime,
    "00:00",
  );
  assert.equal(
    buildCompletionValidator(requiredTime).parse({ washTime: "23:59" }).washTime,
    "23:59",
  );
});

test("время: «25:99» и прочий мусор не проходят, ошибка по-русски", () => {
  const validator = buildCompletionValidator(requiredTime);
  for (const bad of ["25:99", "24:00", "7:5", "14-30", "1430", "abc"]) {
    const result = validator.safeParse({ washTime: bad });
    assert.equal(result.success, false, `«${bad}» не должно проходить`);
  }
  const failure = validator.safeParse({ washTime: "25:99" });
  assert.equal(failure.success, false);
  if (!failure.success) {
    assert.match(failure.error.issues[0]?.message ?? "", /ЧЧ:ММ/);
  }
});

test("время: обязательное поле нельзя оставить пустым", () => {
  const validator = buildCompletionValidator(requiredTime);
  assert.equal(validator.safeParse({ washTime: "" }).success, false);
  assert.equal(validator.safeParse({}).success, false);
});

test("время: необязательное поле можно оставить пустым", () => {
  const validator = buildCompletionValidator(optionalTime);
  assert.equal(validator.safeParse({ arrivalTime: "" }).success, true);
  assert.equal(validator.safeParse({ arrivalTime: null }).success, true);
  assert.equal(validator.safeParse({}).success, true);
  // Но если что-то ввели — формат всё равно проверяется.
  assert.equal(validator.safeParse({ arrivalTime: "99:99" }).success, false);
  assert.equal(
    buildCompletionValidator(optionalTime).parse({ arrivalTime: "09:30" }).arrivalTime,
    "09:30",
  );
});
