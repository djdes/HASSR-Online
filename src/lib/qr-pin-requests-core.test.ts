import assert from "node:assert/strict";
import test from "node:test";

import {
  PIN_REQUEST_TTL_MS,
  isPinRequestActionable,
  pinRequestExpiresAt,
  pinRequestKindLabel,
  pinRequestStatusText,
  validatePinRequestInput,
} from "@/lib/qr-pin-requests-core";

/**
 * «Запросить доступ» / «Запросить смену PIN»: сотрудник сам придумывает
 * PIN на QR-странице, руководитель одобряет. Проверка ввода — до отправки.
 */
test("PIN в запросе: правила PIN и совпадение повтора", () => {
  assert.equal(validatePinRequestInput({ pin: "4821", repeat: "4821" }), null);
  assert.match(validatePinRequestInput({ pin: "4821", repeat: "4812" }) ?? "", /не совпадают/);
  assert.match(validatePinRequestInput({ pin: "1111", repeat: "1111" }) ?? "", /простой/);
  assert.match(validatePinRequestInput({ pin: "48", repeat: "48" }) ?? "", /4 до 6/);
});

test("запрос живёт неделю и решается только в ожидании", () => {
  const now = new Date("2026-09-22T10:00:00Z");
  const expiresAt = pinRequestExpiresAt(now);
  assert.equal(expiresAt.getTime() - now.getTime(), PIN_REQUEST_TTL_MS);
  const pending = { status: "pending", expiresAt };
  assert.equal(isPinRequestActionable(pending, now), true);
  assert.equal(isPinRequestActionable({ ...pending, status: "approved" }, now), false);
  assert.equal(isPinRequestActionable(pending, new Date(expiresAt.getTime() + 1)), false);
});

test("понятные подписи вида и статуса", () => {
  assert.equal(pinRequestKindLabel("issue"), "Новый PIN");
  assert.equal(pinRequestKindLabel("change"), "Смена PIN");
  assert.match(pinRequestStatusText({ status: "pending", kind: "issue" }) ?? "", /ждёт/);
  assert.match(pinRequestStatusText({ status: "rejected", kind: "change", decisionNote: "Не узнал" }) ?? "", /отклонил.*Не узнал/);
  assert.equal(pinRequestStatusText({ status: "superseded", kind: "issue" }), null);
});
