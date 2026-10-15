import assert from "node:assert/strict";
import test from "node:test";

import { staffApiErrorKey } from "@/components/staff/staff-api-error";

test("known staff API errors map to stable localized keys", () => {
  assert.equal(staffApiErrorKey("Это действие доступно руководителю"), "managerOnly");
  assert.equal(staffApiErrorKey("Должность не найдена в этой организации"), "positionNotFound");
  assert.equal(staffApiErrorKey("Дата окончания раньше даты начала"), "endBeforeStart");
  assert.equal(staffApiErrorKey("ROOT-учётную запись нельзя архивировать"), "rootCannotArchive");
});

test("unknown and absent staff API errors use the caller's safe localized fallback", () => {
  assert.equal(staffApiErrorKey("Database connection failed"), null);
  assert.equal(staffApiErrorKey(undefined), null);
});
