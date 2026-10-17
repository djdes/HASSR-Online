import test from "node:test";
import assert from "node:assert/strict";

import { buildHaccpTeamOrderValues } from "./team-order";

const staff = [
  { id: "u1", name: "Иванова О. П.", title: "Управляющий" },
  { id: "u2", name: "Петров С. А.", title: "Шеф-повар" },
  { id: "u3", name: "Сидорова Н. В.", title: "" },
];

test("руководитель отдельно, остальные — строками «Должность — Ф. И. О.»", () => {
  const values = buildHaccpTeamOrderValues(
    [
      { userId: "u1", role: "leader", duties: "" },
      { userId: "u2", role: "member", duties: "" },
      { userId: "u3", role: "secretary", duties: "" },
    ],
    staff,
  );
  assert.equal(values.leaderName, "Иванова О. П.");
  assert.equal(values.leaderPost, "Управляющий");
  assert.equal(values.members, "Шеф-повар — Петров С. А.\nСидорова Н. В.");
});

test("нет руководителя или сотрудник ушёл из штата — пустые значения и пропуск", () => {
  const values = buildHaccpTeamOrderValues(
    [
      { userId: "gone", role: "leader", duties: "" },
      { userId: "gone2", role: "member", duties: "" },
    ],
    staff,
  );
  assert.deepEqual(values, { leaderName: "", leaderPost: "", members: "" });
  assert.equal(buildHaccpTeamOrderValues([], staff).members, "");
});
