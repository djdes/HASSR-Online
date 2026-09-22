import assert from "node:assert/strict";
import test from "node:test";

import { HEALTH_CONFIRMATIONS, healthDecision } from "@/lib/health-qr";
import { hygieneV2View } from "@/lib/hygiene-v2";

import {
  buildHygieneTaskForm,
  hygieneV2DeclarationEntry,
  readHygieneV2Checked,
} from "./hygiene";
import { buildCompletionValidator } from "./task-form";

const ALL = HEALTH_CONFIRMATIONS.map((item) => item.key);
const ALL_SIGNED = { temperature: true, infection: true, respiratorySkin: true };
const ADMITTED = {
  result: "admitted",
  byUserId: "keeper-1",
  byName: "Петрова Ольга",
  byTitle: "Заведующий производством",
  at: "08:20",
  method: "qr",
} as const;

test("форма v1: «Состояние» и «Температура выше 37°C», как раньше", () => {
  const form = buildHygieneTaskForm({ formVersion: 1 });
  assert.deepEqual(
    form.fields.map((field) => [field.type, field.key]),
    [
      ["select", "status"],
      ["boolean", "temperatureAbove37"],
    ]
  );
  const status = form.fields[0];
  assert.equal(status.type === "select" ? status.defaultValue : null, "healthy");
  assert.match(form.intro ?? "", /^Отметьте своё состояние перед сменой/);
});

test("форма v1 с сотрудником: имя во вступлении, вчерашние значения по умолчанию", () => {
  const form = buildHygieneTaskForm({
    formVersion: 1,
    employeeName: "Иванова Анна",
    yesterday: { status: "sick_leave", temperatureAbove37: true },
  });
  assert.match(form.intro ?? "", /^Иванова Анна, отметьте своё состояние перед сменой/);
  const [status, temperature] = form.fields;
  assert.equal(status.type === "select" ? status.defaultValue : null, "sick_leave");
  assert.equal(temperature.type === "boolean" ? temperature.defaultValue : null, true);
});

test("форма v2: три подписи сотрудника как в QR, галки не стоят заранее", () => {
  const form = buildHygieneTaskForm({
    formVersion: 2,
    employeeName: "Иванова Анна",
    // Вчерашнюю отметку в новую форму не переносим — подписывает сам сотрудник.
    yesterday: { status: "healthy", confirmations: ALL_SIGNED },
  });
  assert.deepEqual(
    form.fields.map((field) => field.key),
    ["temperature", "infection", "respiratorySkin"]
  );
  form.fields.forEach((field, index) => {
    assert.equal(field.type, "boolean");
    assert.equal(field.label, HEALTH_CONFIRMATIONS[index].label);
    assert.equal(field.type === "boolean" ? field.defaultValue : null, false);
  });
  assert.match(form.intro ?? "", /^Иванова Анна, подпишите/);
  assert.match(form.intro ?? "", /заведомо ложные сведения/);
  assert.equal(form.submitLabel, "Подписать");
});

test("форма v2 без сотрудника — тот же бланк, без имени", () => {
  const form = buildHygieneTaskForm({ formVersion: 2 });
  assert.deepEqual(form.fields.map((field) => field.key), ALL);
  assert.match(form.intro ?? "", /^Подпишите/);
});

test("подписи в значениях задачи: ни одной графы — форма v2 не заполнялась", () => {
  assert.equal(readHygieneV2Checked(undefined), null);
  assert.equal(readHygieneV2Checked(null), null);
  assert.equal(readHygieneV2Checked({}), null);
  // Старая форма: TasksFlow мог открыть её до перехода документа на новый бланк.
  assert.equal(readHygieneV2Checked({ status: "healthy", temperatureAbove37: false }), null);
  assert.equal(
    readHygieneV2Checked({ temperature: null, infection: null, respiratorySkin: null }),
    null
  );
});

test("подписи в значениях задачи: отмеченные графы — подписаны, снятые и пропущенные — нет", () => {
  assert.deepEqual(readHygieneV2Checked(ALL_SIGNED), ALL);
  assert.deepEqual(
    readHygieneV2Checked({ temperature: true, infection: false, respiratorySkin: true }),
    ["temperature", "respiratorySkin"]
  );
  // Всё снято — это тоже подпись: сотрудник сообщил о жалобах.
  assert.deepEqual(
    readHygieneV2Checked({ temperature: false, infection: false, respiratorySkin: false }),
    []
  );
  assert.deepEqual(readHygieneV2Checked({ temperature: true }), ["temperature"]);
  // Непонятное значение подписью не считается.
  assert.deepEqual(readHygieneV2Checked({ temperature: "да", infection: "on" }), ["infection"]);
});

test("валидатор формы v2 пропускает подписи и не выдумывает отсутствующие", () => {
  const validator = buildCompletionValidator(buildHygieneTaskForm({ formVersion: 2 }));
  assert.deepEqual(
    readHygieneV2Checked(
      validator.parse({ temperature: true, infection: false, respiratorySkin: true })
    ),
    ["temperature", "respiratorySkin"]
  );
  assert.equal(readHygieneV2Checked(validator.parse({})), null);
  assert.equal(
    readHygieneV2Checked(validator.parse({ status: "healthy", temperatureAbove37: false })),
    null
  );
});

test("запись дня v2: три подписи — «Здоров», подписи, время, источник TasksFlow", () => {
  const data = hygieneV2DeclarationEntry({
    decision: healthDecision(ALL),
    previous: null,
    at: "08:15",
  });
  assert.deepEqual(data, {
    status: "healthy",
    temperatureAbove37: false,
    confirmations: ALL_SIGNED,
    source: "tasksflow",
    confirmedAt: "08:15",
  });
  const view = hygieneV2View(data);
  assert.equal(view.declared, true);
  assert.equal(view.declaredAt, "08:15");
  assert.equal(view.result, null);
});

test("запись дня v2: не подписана температура — «Отстранён», температура выше 37", () => {
  const data = hygieneV2DeclarationEntry({
    decision: healthDecision(["infection", "respiratorySkin"]),
    previous: null,
    at: "08:15",
  });
  assert.equal(data.status, "suspended");
  assert.equal(data.temperatureAbove37, true);
  assert.deepEqual(data.confirmations, {
    temperature: false,
    infection: true,
    respiratorySkin: true,
  });
});

test("та же подпись повторно — допуск ответственного остаётся как был", () => {
  const previous = {
    status: "healthy",
    temperatureAbove37: false,
    confirmations: ALL_SIGNED,
    source: "qr",
    confirmedAt: "08:05",
    verification: ADMITTED,
  };
  const data = hygieneV2DeclarationEntry({ decision: healthDecision(ALL), previous, at: "09:00" });
  assert.deepEqual(data.verification, ADMITTED);
  assert.equal(data.status, "healthy");
  assert.equal(data.source, "tasksflow");
  assert.equal(data.confirmedAt, "09:00");
});

test("решение «отстранён» не перебивается той же подписью сотрудника", () => {
  const suspended = { ...ADMITTED, result: "suspended" as const };
  const previous = {
    status: "suspended",
    temperatureAbove37: false,
    confirmations: ALL_SIGNED,
    source: "qr",
    confirmedAt: "08:05",
    verification: suspended,
  };
  const data = hygieneV2DeclarationEntry({ decision: healthDecision(ALL), previous, at: "09:00" });
  assert.equal(data.status, "suspended");
  assert.deepEqual(data.verification, suspended);
});

test("подпись изменилась — прежний допуск снимается, нужен новый", () => {
  const previous = {
    status: "healthy",
    temperatureAbove37: false,
    confirmations: ALL_SIGNED,
    source: "qr",
    confirmedAt: "08:05",
    verification: ADMITTED,
  };
  const data = hygieneV2DeclarationEntry({
    decision: healthDecision(["infection", "respiratorySkin"]),
    previous,
    at: "09:00",
  });
  assert.equal("verification" in data, false);
  assert.equal(data.status, "suspended");
});

test("допуск без подписи сотрудника не переносится на новую подпись", () => {
  const previous = { status: "healthy", temperatureAbove37: false, verification: ADMITTED };
  const data = hygieneV2DeclarationEntry({ decision: healthDecision(ALL), previous, at: "09:00" });
  assert.equal("verification" in data, false);
  assert.equal(data.status, "healthy");
});

test("прежняя отметка QR из пяти подтверждений сравнивается по трём графам", () => {
  const previous = {
    status: "healthy",
    temperatureAbove37: false,
    confirmations: { temperature: true, intestinal: true, family: true, respiratory: true, skin: true },
    source: "qr",
    confirmedAt: "08:05",
    verification: ADMITTED,
  };
  const data = hygieneV2DeclarationEntry({ decision: healthDecision(ALL), previous, at: "09:00" });
  assert.deepEqual(data.verification, ADMITTED);
});
