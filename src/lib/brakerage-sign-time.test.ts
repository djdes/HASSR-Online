import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_SIGNATURE_WINDOW_MINUTES,
  commissionRowStatus,
  formatRowSignatures,
  normalizeRowSignatures,
  signatureJournalTime,
  type BrakerageRowSignature,
} from "@/lib/brakerage-commission";
import {
  COMMISSION_SIGN_AFTER_REJECTION_MINUTES,
  commissionSignDefaultTime,
  rowRejectionDateTime,
  withLocalTime,
} from "@/lib/brakerage-times";
import { createFinishedProductRow, finishedProductCellText } from "@/lib/finished-product-document";

/**
 * БЖГП (решение владельца 2026-09-30): время подписи бракеражной комиссии в
 * журнале = время бракеража строки + 1 минута. Настоящий момент нажатия
 * остаётся в `signedAt` (и в журналах подписей и действий), в журнале — время
 * от бракеража. Москва = UTC+3: «09:33Z» — это 12:33.
 */
const TZ = "Europe/Moscow";
const row = { productionDateTime: "2026-09-30 12:25", rejectionTime: "2026-09-30 12:30" };
/** Подпись по новому правилу: подписали в 14:05, в журнал встало 12:31. */
const signedNow: BrakerageRowSignature = {
  userId: "u1",
  name: "Иванова Анна Андреевна",
  role: "Председатель",
  signedAt: "2026-09-30T11:05:00.000Z",
  journalAt: "2026-09-30 12:31",
  method: "session",
};
/** Старая подпись (до правила): только настоящее время. */
const legacy = (signedAt: string): BrakerageRowSignature => ({
  userId: "u2",
  name: "Петров Пётр",
  role: "Член комиссии",
  signedAt,
  method: "qr",
});

test("+1 минута к времени бракеража: 12:30 → 12:31", () => {
  assert.equal(COMMISSION_SIGN_AFTER_REJECTION_MINUTES, 1);
  assert.equal(commissionSignDefaultTime(row), "2026-09-30 12:31");
  assert.equal(signatureJournalTime(signedNow, row, TZ), "12:31");
  // Настоящий момент (14:05) в журнал не попадает, но в подписи хранится.
  assert.equal(formatRowSignatures([signedNow], TZ, row), "Иванова А. А. · 12:31");
  assert.equal(signedNow.signedAt, "2026-09-30T11:05:00.000Z");
});

test("экран-карточка и печать: ячейка подписи — время бракеража + 1 минута", () => {
  const journalRow = createFinishedProductRow({ ...row, productName: "Суп куриный", signatures: [signedNow] });
  assert.equal(finishedProductCellText(journalRow, "signatures"), "Иванова А. А. · 12:31");
  assert.equal(finishedProductCellText(journalRow, "rejection"), "2026-09-30 12:30");
});

test("переход через полночь", () => {
  assert.equal(commissionSignDefaultTime({ rejectionTime: "2026-09-30 23:59" }), "2026-10-01 00:00");
  assert.equal(commissionSignDefaultTime({ rejectionTime: "2026-12-31 23:59" }), "2027-01-01 00:00");
  const late = { productionDateTime: "2026-09-30 23:50", rejectionTime: "2026-09-30 23:59" };
  assert.equal(
    signatureJournalTime({ signedAt: "2026-09-30T21:10:00.000Z", journalAt: "2026-10-01 00:00" }, late, TZ),
    "00:00"
  );
});

test("бракераж записан без даты («ЧЧ:ММ» — «Повторить», демо): дата — от изготовления", () => {
  assert.equal(rowRejectionDateTime({ productionDateTime: "2026-09-30 12:25", rejectionTime: "12:30" }), "2026-09-30 12:30");
  assert.equal(commissionSignDefaultTime({ productionDateTime: "2026-09-30 12:25", rejectionTime: "12:30" }), "2026-09-30 12:31");
  // Бракераж после полуночи: изготовление 23:58, бракераж «00:02» — уже следующий день.
  assert.equal(rowRejectionDateTime({ productionDateTime: "2026-09-30 23:58", rejectionTime: "00:02" }), "2026-10-01 00:02");
  assert.equal(commissionSignDefaultTime({ productionDateTime: "2026-09-30 23:58", rejectionTime: "0:02" }), "2026-10-01 00:03");
  // Ни даты изготовления, ни даты бракеража — только время, по кругу суток.
  assert.equal(commissionSignDefaultTime({ rejectionTime: "23:59" }), "00:00");
});

test("нет времени бракеража — как сейчас: настоящее время подписи", () => {
  assert.equal(commissionSignDefaultTime({ rejectionTime: "" }), "");
  assert.equal(commissionSignDefaultTime({ rejectionTime: "обед", productionDateTime: "2026-09-30 12:25" }), "");
  assert.equal(commissionSignDefaultTime({}), "");
  // Сервер не ставит journalAt строке без бракеража — в журнале 14:07.
  const plain = { signedAt: "2026-09-30T11:07:00.000Z" };
  assert.equal(signatureJournalTime(plain, { rejectionTime: "" }, TZ), "14:07");
  assert.equal(signatureJournalTime(plain, null, TZ), "14:07");
  assert.equal(formatRowSignatures([legacy("2026-09-30T11:07:00.000Z")], TZ), "Петров П. · 14:07");
});

test("правка вручную: время бракеража поменяли — подпись идёт за ним", () => {
  // Руководитель исправил бракераж в окне блюда или в таблице: 12:30 → 12:40.
  assert.equal(signatureJournalTime(signedNow, { ...row, rejectionTime: "2026-09-30 12:40" }, TZ), "12:41");
  // Вписали в ячейку только время.
  assert.equal(signatureJournalTime(signedNow, { ...row, rejectionTime: "12:40" }, TZ), "12:41");
  // Комиссия поправила бракераж на QR при подписи — сервер кладёт его на дату строки.
  const corrected = withLocalTime(row.productionDateTime, "12:45");
  assert.equal(commissionSignDefaultTime({ ...row, rejectionTime: corrected }), "2026-09-30 12:46");
  // Бракераж стёрли — остаётся время, вставшее в журнал при подписи.
  assert.equal(signatureJournalTime(signedNow, { ...row, rejectionTime: "" }, TZ), "12:31");
  // В окне блюда «Комиссия» показывает то же время, что таблица и печать.
  const members = [
    { id: "m1", role: "Председатель", employeeId: "u1", employeeName: "Иванова Анна Андреевна" },
    { id: "m2", role: "Член комиссии", employeeId: "u3", employeeName: "Сидоров" },
  ];
  const status = commissionRowStatus({ ...row, rejectionTime: "2026-09-30 12:40", signatures: [signedNow] }, members, TZ);
  assert.deepEqual(
    status.map((member) => [member.employeeId, member.signed, member.journalTime]),
    [
      ["u1", true, "12:41"],
      ["u3", false, ""],
    ]
  );
});

test(`старые подписи: в пределах ${LEGACY_SIGNATURE_WINDOW_MINUTES} минут после бракеража — как есть, иначе бракераж + 1`, () => {
  assert.equal(LEGACY_SIGNATURE_WINDOW_MINUTES, 5);
  // 12:33 и ровно 12:35 — похоже на подпись на бракераже: не трогаем.
  assert.equal(signatureJournalTime(legacy("2026-09-30T09:33:00.000Z"), row, TZ), "12:33");
  assert.equal(signatureJournalTime(legacy("2026-09-30T09:35:00.000Z"), row, TZ), "12:35");
  // Позже разрешения к реализации, раньше бракеража, утром следующего дня — 12:31.
  assert.equal(signatureJournalTime(legacy("2026-09-30T09:36:00.000Z"), row, TZ), "12:31");
  assert.equal(signatureJournalTime(legacy("2026-09-30T09:20:00.000Z"), row, TZ), "12:31");
  assert.equal(signatureJournalTime(legacy("2026-10-01T06:15:00.000Z"), row, TZ), "12:31");
  // Данные не переписываются: настоящее время на месте, journalAt не появился.
  const [stored] = normalizeRowSignatures([legacy("2026-10-01T06:15:00.000Z")]);
  assert.equal(stored.signedAt, "2026-10-01T06:15:00.000Z");
  assert.equal("journalAt" in stored, false);
});

test("journalAt сохраняется при нормализации, мусор отбрасывается", () => {
  const [kept, timeOnly, junk] = normalizeRowSignatures([
    { ...signedNow, userId: "a" },
    { ...signedNow, userId: "b", journalAt: "12:31" },
    { ...signedNow, userId: "c", journalAt: "вчера" },
  ]);
  assert.equal(kept.journalAt, "2026-09-30 12:31");
  assert.equal(timeOnly.journalAt, "12:31");
  assert.equal("journalAt" in junk, false);
});
