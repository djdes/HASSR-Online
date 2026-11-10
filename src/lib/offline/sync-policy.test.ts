import assert from "node:assert/strict";
import { test } from "node:test";

import { canDeliverOfflineItem, decideOfflineDelivery, needsPinReentry, offlineRetryDelayMs } from "./sync-policy";

test("accepted record leaves the queue", () => {
  assert.deepEqual(decideOfflineDelivery({ kind: "http", status: 200, body: { mode: "updated" } as never }), { kind: "done" });
});

test("accepted with conflicts stays for the person to decide", () => {
  const decision = decideOfflineDelivery({
    kind: "http",
    status: 200,
    body: { conflicts: [{ key: "temp", label: "Температура", mine: 5, theirs: 7 }, { nope: true }] },
  });
  assert.deepEqual(decision, { kind: "conflict", conflicts: [{ key: "temp", label: "Температура", mine: 5, theirs: 7 }] });
});

test("no network, server trouble and missing sign-in are retried, not refused", () => {
  assert.equal(decideOfflineDelivery({ kind: "network" }).kind, "retry");
  assert.equal(decideOfflineDelivery({ kind: "http", status: 502, body: null }).kind, "retry");
  assert.equal(decideOfflineDelivery({ kind: "http", status: 429, body: { error: "Слишком много" } }).kind, "retry");
  assert.equal(decideOfflineDelivery({ kind: "http", status: 409, body: { code: "offline-in-flight" } }).kind, "retry");
  const login = decideOfflineDelivery({ kind: "http", status: 401, body: { code: "offline-login", error: "Войдите" } });
  assert.deepEqual(login, { kind: "retry", error: "Войдите", code: "offline-login" });
});

test("a refusal keeps the record visible with its reason", () => {
  const old = decideOfflineDelivery({ kind: "http", status: 422, body: { code: "offline-time-too-old", error: "Запись старше 31 дня" } });
  assert.deepEqual(old, { kind: "rejected", error: "Запись старше 31 дня", code: "offline-time-too-old" });
  // A wrong QR token is a 401 with its own text, not "sign in".
  const sticker = decideOfflineDelivery({ kind: "http", status: 401, body: { error: "Неверная QR-наклейка", code: "bad-sticker" } });
  assert.equal(sticker.kind, "rejected");
  assert.equal(decideOfflineDelivery({ kind: "http", status: 403, body: null }).kind, "rejected");
});

test("PIN refusals ask for the PIN again", () => {
  assert.equal(needsPinReentry({ status: "rejected", lastCode: "offline-pin-changed" }), true);
  assert.equal(needsPinReentry({ status: "rejected", lastCode: "offline-pin-required" }), true);
  assert.equal(needsPinReentry({ status: "rejected", lastCode: "offline-time-future" }), false);
  assert.equal(needsPinReentry({ status: "pending", lastCode: "offline-pin-changed" }), false);
});

test("records are delivered only under the account they were made with", () => {
  assert.equal(canDeliverOfflineItem("u1", "u1"), true);
  assert.equal(canDeliverOfflineItem("u1", "u2"), false);
  assert.equal(canDeliverOfflineItem("u1", null), false);
  assert.equal(canDeliverOfflineItem(null, null), false);
});

test("retry delay grows and is capped", () => {
  assert.equal(offlineRetryDelayMs(1), 5_000);
  assert.equal(offlineRetryDelayMs(3), 60_000);
  assert.equal(offlineRetryDelayMs(99), 15 * 60_000);
});

test("a server that keeps failing is not retried forever", () => {
  const body = { error: "Не удалось записать в журнал" };
  assert.equal(decideOfflineDelivery({ kind: "http", status: 500, body }, 3).kind, "retry");
  assert.deepEqual(decideOfflineDelivery({ kind: "http", status: 500, body }, 4), {
    kind: "rejected",
    error: "Не удалось записать в журнал",
    code: "offline-server-error",
  });
  // No network and a busy server never turn into a refusal.
  assert.equal(decideOfflineDelivery({ kind: "network" }, 50).kind, "retry");
  assert.equal(decideOfflineDelivery({ kind: "http", status: 429, body: null }, 50).kind, "retry");
});
