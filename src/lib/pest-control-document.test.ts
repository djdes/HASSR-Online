import assert from "node:assert/strict";
import test from "node:test";

import {
  getPestControlEmployeesForRole,
  getPestControlRoleOptions,
  normalizePestControlEntryData,
} from "./pest-control-document";

test("запись без времени не превращается в 00:00", () => {
  const data = normalizePestControlEntryData({
    performedDate: "2026-03-02",
    performedHour: "",
    performedMinute: "",
    event: "Дератизация",
  });
  assert.equal(data.timeSpecified, false);
  assert.equal(data.performedHour, "");
  assert.equal(data.performedMinute, "");
});

test("указанное время сохраняется и дополняется нулём", () => {
  const data = normalizePestControlEntryData({
    performedDate: "2026-03-02",
    performedHour: "9",
    performedMinute: "5",
  });
  assert.equal(data.timeSpecified, true);
  assert.equal(data.performedHour, "09");
  assert.equal(data.performedMinute, "05");
});

test("полночь остаётся полночью, если время задано явно", () => {
  const data = normalizePestControlEntryData({
    performedDate: "2026-03-02",
    performedHour: "00",
    performedMinute: "00",
    timeSpecified: true,
  });
  assert.equal(data.timeSpecified, true);
  assert.equal(data.performedHour, "00");
  assert.equal(data.performedMinute, "00");
});

/**
 * «Должность принявшего работы» — должность самого принявшего из его
 * карточки. Строка из TasksFlow приходит без должности: раньше ей
 * подставлялась первая роль организации («Управляющий») под фамилией
 * другого человека.
 */
const pestUsers = [
  { id: "mgr", name: "Репешко И.В.", role: "manager" },
  {
    id: "akul",
    name: "Акулинина Е.В.",
    role: "cook",
    jobPosition: { name: "Кладовщик", categoryKey: "staff" },
  },
];

test("дезинсекция: пустая должность берётся у принявшего, не первая роль организации", () => {
  const data = normalizePestControlEntryData(
    { performedDate: "2026-09-21", acceptedRole: "", acceptedEmployeeId: "" },
    "2026-09-21",
    pestUsers,
    "akul"
  );
  assert.equal(data.acceptedEmployeeId, "akul");
  assert.equal(data.acceptedRole, "Кладовщик");
});

test("дезинсекция: варианты должностей — из справочника, как фильтр сотрудников", () => {
  const labels = getPestControlRoleOptions(pestUsers).map((option) => option.value);
  assert.ok(labels.includes("Кладовщик"));
  assert.deepEqual(
    getPestControlEmployeesForRole(pestUsers, "Кладовщик").map((user) => user.id),
    ["akul"]
  );
});
