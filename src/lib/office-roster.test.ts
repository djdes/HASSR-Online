import assert from "node:assert/strict";
import test from "node:test";

import { isOfficeLeader } from "@/lib/office-roster";

const KNOWN = ["office", "p1", "p2"];

test("человек офиса — в «Руководстве» офиса", () => {
  assert.ok(isOfficeLeader({ role: "cook", buildingIds: ["office"] }, "office", KNOWN));
});

test("руководство всей компании (роль или должность руководства, без объектов) — тоже", () => {
  assert.ok(isOfficeLeader({ role: "owner", buildingIds: [] }, "office", KNOWN));
  assert.ok(isOfficeLeader({ role: "manager", buildingIds: [] }, "office", KNOWN));
  assert.ok(isOfficeLeader({ role: "cook", buildingIds: [], jobPosition: { categoryKey: "management" } }, "office", KNOWN));
  // Висящие id удалённых объектов не делают человека сотрудником объекта.
  assert.ok(isOfficeLeader({ role: "manager", buildingIds: ["deleted"] }, "office", KNOWN));
  // Офиса ещё нет — руководство всей компании всё равно видно.
  assert.ok(isOfficeLeader({ role: "manager", buildingIds: [] }, null, KNOWN));
});

test("руководитель объекта и линейные сотрудники — нет", () => {
  assert.ok(!isOfficeLeader({ role: "manager", buildingIds: ["p1"] }, "office", KNOWN));
  assert.ok(!isOfficeLeader({ role: "cook", buildingIds: [] }, "office", KNOWN));
  assert.ok(!isOfficeLeader({ role: "cook", buildingIds: ["p2"], jobPosition: { categoryKey: "staff" } }, "office", KNOWN));
});
