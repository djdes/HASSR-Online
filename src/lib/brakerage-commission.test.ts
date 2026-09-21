import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRowSignatures,
  isRowClosed,
  normalizeCommissionMembers,
  normalizeRowSignatures,
  shortPersonName,
} from "./brakerage-commission";

test("состав комиссии: без имени отбрасываем, повтор сотрудника — тоже, не больше 10", () => {
  const members = normalizeCommissionMembers([
    { employeeName: "Иванова Анна", employeeId: "u1", role: "Председатель" },
    { employeeName: "Иванова Анна", employeeId: "u1" },
    { employeeName: "" },
    { employeeName: "Петров" },
    ...Array.from({ length: 12 }, (_, i) => ({ employeeName: `Член ${i}` })),
  ]);
  assert.equal(members.length, 10);
  assert.equal(members[0].role, "Председатель");
  assert.equal(members[1].role, "Член комиссии");
  assert.equal(members[1].employeeId, "");
});

test("подписи: последняя на человека, по времени, мусор отброшен", () => {
  const signatures = normalizeRowSignatures([
    { userId: "u2", name: "Петров", signedAt: "2026-09-21T09:10:00.000Z" },
    { userId: "u1", name: "Иванова", signedAt: "2026-09-21T09:00:00.000Z", grade: "Отлично" },
    { userId: "u1", name: "Иванова", signedAt: "2026-09-21T09:20:00.000Z", grade: "Хорошо" },
    { userId: "", signedAt: "2026-09-21T09:00:00.000Z" },
    { userId: "u3", signedAt: "не дата" },
  ]);
  assert.deepEqual(signatures.map((s) => `${s.userId}:${s.grade ?? ""}`), ["u2:", "u1:Хорошо"]);
});

test("строка закрыта: без комиссии — всегда, с комиссией — хотя бы одна подпись", () => {
  const withCommission = { commissionMembers: [{ id: "c", role: "Председатель", employeeId: "u1", employeeName: "Иванова" }] };
  assert.equal(isRowClosed({}, { commissionMembers: [] }), true);
  assert.equal(isRowClosed({}, withCommission), false);
  assert.equal(
    isRowClosed({ signatures: [{ userId: "u1", name: "Иванова", signedAt: "2026-09-21T09:00:00Z" }] }, withCommission),
    true
  );
});

test("подпись в ячейке: фамилия с инициалами и время в поясе организации", () => {
  assert.equal(shortPersonName("Иванова Анна Андреевна"), "Иванова А. А.");
  assert.equal(shortPersonName("Иванова"), "Иванова");
  assert.equal(
    formatRowSignatures(
      [{ userId: "u1", name: "Иванова Анна Андреевна", role: "", signedAt: "2026-09-21T08:52:00.000Z", method: "qr" }],
      "Europe/Moscow"
    ),
    "Иванова А. А. · 11:52"
  );
});
