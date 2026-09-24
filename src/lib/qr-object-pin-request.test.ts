import assert from "node:assert/strict";
import test from "node:test";

import {
  PIN_APPROVED_NOTE_MS,
  parseQrObjectPinRequest,
  parseQrObjectPinTarget,
  qrPinRequestScreen,
} from "@/lib/qr-object-pin-request";

/**
 * Запрос PIN с наклейки объекта (холодильник, помещение, УФ-лампа):
 * разбор тела и строки статуса — те же правила, что у QR-журналов.
 */
const target = { kind: "equipment", objectId: "eq-1", token: "equipment:eq-1.1.sig", employeeId: "u-1" };

test("наклейка и сотрудник: всё на месте — принимаем, лишнее отбрасываем", () => {
  assert.deepEqual(parseQrObjectPinTarget({ ...target, extra: 1 }), target);
  assert.deepEqual(parseQrObjectPinTarget({ ...target, kind: "room", objectId: " r-1 " }), { ...target, kind: "room", objectId: "r-1" });
});

test("наклейка и сотрудник: неполные или чужие данные — отказ", () => {
  assert.equal(parseQrObjectPinTarget(null), null);
  assert.equal(parseQrObjectPinTarget([target]), null);
  assert.equal(parseQrObjectPinTarget({ ...target, kind: "journal" }), null);
  assert.equal(parseQrObjectPinTarget({ ...target, token: "" }), null);
  assert.equal(parseQrObjectPinTarget({ ...target, employeeId: 42 }), null);
  assert.equal(parseQrObjectPinTarget({ ...target, token: "x".repeat(513) }), null);
});

test("тело запроса: PIN дважды, вид — «выдать» по умолчанию", () => {
  assert.deepEqual(parseQrObjectPinRequest({ ...target, pin: " 4821 ", pin2: "4821" }), {
    ...target,
    pin: "4821",
    pin2: "4821",
    requestKind: "issue",
  });
  assert.equal(parseQrObjectPinRequest({ ...target, pin: "4821", pin2: "4821", requestKind: "change" })?.requestKind, "change");
  assert.equal(parseQrObjectPinRequest({ ...target, requestKind: "drop" })?.requestKind, "issue");
  const noPins = parseQrObjectPinRequest({ ...target, pin: 4821 });
  assert.equal(noPins?.pin, "");
  assert.equal(noPins?.pin2, "");
  assert.equal(parseQrObjectPinRequest({ pin: "4821", pin2: "4821" }), null);
});

test("статус: нет запроса — показывать нечего", () => {
  assert.deepEqual(qrPinRequestScreen(null), { status: null, approvedNote: null });
  assert.deepEqual(qrPinRequestScreen({ kind: "issue", status: "superseded" }), { status: null, approvedNote: null });
});

test("статус: ждёт — спокойная строка, отклонён — красная с причиной", () => {
  const pending = qrPinRequestScreen({ kind: "issue", status: "pending" });
  assert.equal(pending.status?.tone, "wait");
  assert.match(pending.status?.text ?? "", /ждёт одобрения/);
  assert.equal(pending.approvedNote, null);
  const rejected = qrPinRequestScreen({ kind: "change", status: "rejected", decisionNote: "Не узнал" });
  assert.equal(rejected.status?.tone, "bad");
  assert.match(rejected.status?.text ?? "", /отклонён.*Не узнал/);
});

test("одобрено: зелёная строка над шагом PIN три дня, на экране без PIN — нет", () => {
  const now = new Date("2026-09-22T10:00:00Z");
  const fresh = qrPinRequestScreen({ kind: "issue", status: "approved", decidedAt: new Date(now.getTime() - 3600_000) }, now);
  assert.equal(fresh.status, null);
  assert.match(fresh.approvedNote ?? "", /одобрен/);
  const old = qrPinRequestScreen({ kind: "change", status: "approved", decidedAt: new Date(now.getTime() - PIN_APPROVED_NOTE_MS - 1) }, now);
  assert.deepEqual(old, { status: null, approvedNote: null });
  assert.deepEqual(qrPinRequestScreen({ kind: "issue", status: "approved", decidedAt: null }, now), { status: null, approvedNote: null });
});
