import assert from "node:assert/strict";
import test from "node:test";

import { formatStaffAbsenceNote } from "@/lib/staff-absence";

test("плашка называет вид отсутствия и последний день периода", () => {
  assert.equal(
    formatStaffAbsenceNote({ status: "vacation", untilKey: "2026-09-25" }),
    "Сегодня у вас по графику: отпуск до 25.09"
  );
  assert.equal(
    formatStaffAbsenceNote({ status: "sick_leave", untilKey: "2026-10-03" }),
    "Сегодня у вас по графику: больничный до 03.10"
  );
});

test("выходной — без даты окончания, он всегда на один день", () => {
  assert.equal(
    formatStaffAbsenceNote({ status: "day_off", untilKey: null }),
    "Сегодня у вас по графику: выходной"
  );
});
