import assert from "node:assert/strict";
import test from "node:test";

import {
  closeBlockerForUnsigned,
  formatRowSignatures,
  isSignatureOutdated,
  signatureSnapshot,
  todaySignatureSummary,
  todaySignatureText,
  unsignedRows,
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

const member = { id: "m1", role: "Председатель", employeeId: "u1", employeeName: "Иванова Анна" };
const signed = [{ userId: "u1", name: "Иванова Анна", role: "Председатель", signedAt: "2026-09-21T09:00:00.000Z", method: "qr" }];

test("неподписанные строки: без комиссии — нет, пустые строки не считаем", () => {
  const rows = [
    { id: "a", productName: "Суп", productionDateTime: "2026-09-21 12:00" },
    { id: "b", productName: "Каша", productionDateTime: "2026-09-21 08:00", signatures: signed },
    { id: "c", productName: "", productionDateTime: "" },
  ];
  assert.deepEqual(unsignedRows({ commissionMembers: [], rows }), []);
  assert.deepEqual(unsignedRows({ commissionMembers: [member], rows }).map((row) => row.id), ["a"]);
  assert.equal(closeBlockerForUnsigned({ commissionMembers: [], rows }), null);
  const blocker = closeBlockerForUnsigned({ commissionMembers: [member], rows });
  assert.ok(blocker);
  assert.match(blocker.title, /1 строка ждёт подписи комиссии/);
  assert.deepEqual(blocker.bullets, ["Суп · 21.09 12:00"]);
});

test("плашка «сегодня»: считаем строки дня и ждущие подписи", () => {
  const config = {
    commissionMembers: [member],
    rows: [
      { productName: "Суп", productionDateTime: "2026-09-21 12:00" },
      { productName: "Каша", productionDateTime: "2026-09-21 08:00", signatures: signed },
      { productName: "Вчера", productionDateTime: "2026-09-20 18:00" },
    ],
  };
  const summary = todaySignatureSummary(config, "2026-09-21");
  assert.deepEqual(summary, { total: 2, waiting: 1 });
  assert.equal(todaySignatureText(summary!, false), "Сегодня: 2 строки, 1 ждёт подписи комиссии");
  assert.equal(todaySignatureText({ total: 5, waiting: 0 }, true), "Сегодня: 5 строк, все подписаны комиссией");
  assert.equal(todaySignatureSummary({ commissionMembers: [], rows: config.rows }, "2026-09-21"), null);
});

test("подпись устарела, если строку поменяли после неё", () => {
  const row = { productName: "Суп", organoleptic: "Отлично", portionWeight: "250" };
  const signature = { ...signed[0], snapshot: signatureSnapshot(row) };
  assert.equal(isSignatureOutdated(row, signature), false);
  assert.equal(isSignatureOutdated({ ...row, organoleptic: "Хорошо" }, signature), true);
  assert.equal(isSignatureOutdated(row, signed[0]), false);
});
