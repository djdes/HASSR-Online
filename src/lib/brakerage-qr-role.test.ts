import assert from "node:assert/strict";
import test from "node:test";

import { brakerageQrDefaultView, brakerageQrRole, parseBulkNames } from "./brakerage-qr-role";

const config = { commissionMembers: [{ id: "m1", role: "Председатель", employeeId: "u-commission", employeeName: "Иванова" }] };
const orgMembers = [
  { id: "commission-u-commission", role: "Председатель", employeeId: "u-commission", employeeName: "Иванова" },
  { id: "commission-u-org", role: "Член комиссии", employeeId: "u-org", employeeName: "Петрова" },
];
const base = { config, orgMembers, role: "cook", canEditBrakerageDishes: false, commissionPosition: false };

test("член в копии документа — оценщик, список за сегодня", () => {
  const commission = brakerageQrRole({ ...base, employeeId: "u-commission" });
  assert.deepEqual(commission, { evaluator: true, editor: false, viewer: false });
  assert.equal(brakerageQrDefaultView(commission), "list");
});

test("член только в составе организации — тоже оценщик (копию документа досинхронизируют)", () => {
  const orgOnly = brakerageQrRole({ ...base, config: { commissionMembers: [] }, employeeId: "u-org" });
  assert.deepEqual(orgOnly, { evaluator: true, editor: false, viewer: false });
  assert.equal(brakerageQrDefaultView(orgOnly), "list");
});

test("должность «Член бракеражной комиссии» без состава — только просмотр списка, без подписи", () => {
  const viewer = brakerageQrRole({ ...base, employeeId: "u-stranger", commissionPosition: true });
  assert.deepEqual(viewer, { evaluator: false, editor: false, viewer: true });
  assert.equal(brakerageQrDefaultView(viewer), "list");
});

test("редактор по галке и руководитель правят список; повар без галки — форма", () => {
  const head = brakerageQrRole({ ...base, employeeId: "u-head", canEditBrakerageDishes: true });
  assert.deepEqual(head, { evaluator: false, editor: true, viewer: false });
  assert.equal(brakerageQrDefaultView(head), "list");

  const manager = brakerageQrRole({ ...base, employeeId: "u-manager", role: "manager" });
  assert.equal(manager.editor, true);
  assert.equal(manager.viewer, false);

  const cook = brakerageQrRole({ ...base, employeeId: "u-cook" });
  assert.deepEqual(cook, { evaluator: false, editor: false, viewer: false });
  assert.equal(brakerageQrDefaultView(cook), "add");
});

test("несколько блюд: по строке, без пустых, повторов и нумерации; цифры в названии остаются", () => {
  assert.deepEqual(parseBulkNames("1. Борщ\n\n2) Каша гречневая\n- борщ\n5 злаков салат\n  Компот  "), [
    "Борщ",
    "Каша гречневая",
    "5 злаков салат",
    "Компот",
  ]);
  assert.equal(parseBulkNames(Array.from({ length: 40 }, (_, i) => `Блюдо ${i}`).join("\n")).length, 30);
});
