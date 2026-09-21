import assert from "node:assert/strict";
import test from "node:test";

import { brakerageQrDefaultView, brakerageQrRole, parseBulkNames } from "./brakerage-qr-role";

const config = { commissionMembers: [{ id: "m1", role: "Председатель", employeeId: "u-commission", employeeName: "Иванова" }] };

test("роль на QR: комиссия оценивает, галка и руководство правят, повар добавляет", () => {
  const commission = brakerageQrRole({ config, employeeId: "u-commission", role: "cook", canEditBrakerageDishes: false });
  assert.deepEqual(commission, { evaluator: true, editor: false });
  assert.equal(brakerageQrDefaultView(commission), "list");

  const head = brakerageQrRole({ config, employeeId: "u-head", role: "cook", canEditBrakerageDishes: true });
  assert.deepEqual(head, { evaluator: false, editor: true });
  assert.equal(brakerageQrDefaultView(head), "list");

  const manager = brakerageQrRole({ config, employeeId: "u-manager", role: "manager", canEditBrakerageDishes: false });
  assert.equal(manager.editor, true);

  const cook = brakerageQrRole({ config, employeeId: "u-cook", role: "cook", canEditBrakerageDishes: false });
  assert.deepEqual(cook, { evaluator: false, editor: false });
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
