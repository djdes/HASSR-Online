import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractEmployeeId, rowKeyForEmployee, rowKeyWithQrAppend } from "./row-key";

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
