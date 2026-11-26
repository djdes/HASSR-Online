import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractEmployeeId, rowKeyForEmployee, rowKeyForTaskSubmission, rowKeyWithQrAppend } from "./row-key";

describe("row-key qr append", () => {
  it("keeps the employee id behind the qr suffix", () => {
    const base = rowKeyForEmployee("user1");
    const unique = rowKeyWithQrAppend(base, 123);
    assert.equal(unique, "employee-user1#qr-123");
    assert.equal(extractEmployeeId(unique), "user1");
    assert.equal(rowKeyWithQrAppend(unique, 456), "employee-user1#qr-456");
    assert.equal(extractEmployeeId("employee-user1-time-10:00"), "user1");
  });
});

describe("row-key task submission", () => {
  it("строчные журналы: каждая отправка задачи — свой ключ строки, сотрудник тот же", () => {
    const base = rowKeyForEmployee("user1");
    for (const code of [
      "finished_product",
      "perishable_rejection",
      "intensive_cooling",
      "incoming_control",
      "incoming_raw_materials_control",
      "product_writeoff",
    ]) {
      const first = rowKeyForTaskSubmission(code, base, 100);
      const second = rowKeyForTaskSubmission(code, base, 200);
      assert.equal(first, "employee-user1#tf-100", code);
      assert.notEqual(first, second, code);
      assert.equal(extractEmployeeId(first), "user1", code);
    }
    // Свободная задача: сотрудник из ключа извлекается и с хвостом.
    const free = rowKeyForTaskSubmission("finished_product", "freetask:user2:abc", 5);
    assert.equal(free, "freetask:user2:abc#tf-5");
    assert.equal(extractEmployeeId(free), "user2");
  });

  it("остальные журналы получают ключ задачи как есть", () => {
    assert.equal(rowKeyForTaskSubmission("hygiene", "employee-user1", 100), "employee-user1");
    assert.equal(rowKeyForTaskSubmission("equipment_maintenance", "row-1", 100), "row-1");
    assert.equal(rowKeyForTaskSubmission("accident_journal", "employee-user1", 100), "employee-user1");
  });
});
