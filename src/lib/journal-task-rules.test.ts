import test from "node:test";
import assert from "node:assert/strict";

import { canSelfClaim, decideClaim } from "./journal-task-flow-rules";
import { checkSkipReason, parseSkipReasonPolicy } from "./no-events-reason";
import { completionFieldIssues } from "./journal-completion-rules";

// --- Режим распределения задач -------------------------------------------

test("manual: сотрудник сам взять не может, руководитель назначает", () => {
  assert.deepEqual(decideClaim({ mode: "manual" }), {
    allowed: false,
    reason: "manual_mode",
  });
  assert.deepEqual(decideClaim({ mode: "manual", assignedByManager: true }), {
    allowed: true,
    enforceOneActive: false,
  });
  assert.equal(canSelfClaim("manual", false), false);
});

test("manual: руководитель может взять себе, но одну задачу за раз", () => {
  assert.deepEqual(decideClaim({ mode: "manual", actorCanAssign: true }), {
    allowed: true,
    enforceOneActive: true,
  });
});

test("race: взятие разрешено, одна активная задача", () => {
  assert.deepEqual(decideClaim({ mode: "race" }), {
    allowed: true,
    enforceOneActive: true,
  });
  assert.equal(canSelfClaim("race", false), true);
});

test("shared: взятие разрешено, правило «одна задача за раз» отключено", () => {
  assert.deepEqual(decideClaim({ mode: "shared" }), {
    allowed: true,
    enforceOneActive: false,
  });
});

// --- «Сегодня не требуется» ------------------------------------------------

test("причина из списка принимается, свой текст — только при разрешении", () => {
  const strict = parseSkipReasonPolicy({
    noEventsReasons: ["Поставок нет", " ", 5],
    allowFreeTextReason: false,
  });
  assert.deepEqual(strict, { reasons: ["Поставок нет"], allowFreeText: false });
  assert.deepEqual(checkSkipReason("Поставок нет", strict), {
    ok: true,
    reason: "Поставок нет",
  });
  const refused = checkSkipReason("Не хочу заполнять", strict);
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? "" : refused.message, "Выберите причину из списка");

  const loose = parseSkipReasonPolicy({
    noEventsReasons: ["Поставок нет"],
    allowFreeTextReason: true,
  });
  assert.equal(checkSkipReason("Выходной у кухни", loose).ok, true);
  assert.equal(checkSkipReason("ок", loose).ok, false);
});

test("без списка причин свой текст разрешён всегда", () => {
  const policy = parseSkipReasonPolicy({ noEventsReasons: [], allowFreeTextReason: false });
  assert.equal(policy.allowFreeText, true);
  assert.equal(checkSkipReason("Поставщик не приехал", policy).ok, true);
});

// --- Условная обязательность полей задачи ---------------------------------

test("холодильник вне нормы: действия обязательны", () => {
  const norm = { min: 2, max: 6 };
  const inRange = completionFieldIssues("cold_equipment_control", { temperature: "4" }, { temperatureNorm: norm });
  assert.deepEqual(inRange, { errors: [], conditionalRequired: [] });

  const out = completionFieldIssues("cold_equipment_control", { temperature: "9" }, { temperatureNorm: norm });
  assert.deepEqual(out.conditionalRequired, ["correctiveAction"]);
  assert.equal(out.errors[0]?.field, "correctiveAction");

  const described = completionFieldIssues(
    "cold_equipment_control",
    { temperature: 9, correctiveAction: "Переложили продукты" },
    { temperatureNorm: norm }
  );
  assert.deepEqual(described.errors, []);
  assert.deepEqual(described.conditionalRequired, ["correctiveAction"]);
});

test("гигиена: без отметки «Все допущены» и без примечания завершить нельзя", () => {
  assert.equal(completionFieldIssues("hygiene", {}).errors.length, 1);
  assert.deepEqual(completionFieldIssues("hygiene", { allHealthy: true }).errors, []);
  const notAll = completionFieldIssues("health_check", { allHealthy: false });
  assert.equal(notAll.errors[0]?.field, "notes");
  assert.deepEqual(notAll.conditionalRequired, ["notes"]);
});
