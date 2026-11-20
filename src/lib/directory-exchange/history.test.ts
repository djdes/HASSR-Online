import assert from "node:assert/strict";
import test from "node:test";

import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import {
  ExchangeChangeKeptError,
  HISTORY_DAYS,
  HISTORY_MS,
  changeSnapshot,
  historySource,
  isChangeOp,
  parseChangeSnapshot,
} from "@/lib/directory-exchange/history";
import { rowHash, rowHashLike } from "@/lib/directory-exchange/kinds";

test("history window: 30 days; ops are create and update", () => {
  assert.equal(HISTORY_DAYS, 30);
  assert.equal(HISTORY_MS, 30 * 86_400_000);
  assert.equal(isChangeOp("create"), true);
  assert.equal(isChangeOp("update"), true);
  assert.equal(isChangeOp("tombstone"), false);
});

test("snapshot: fields as the exchange saw them, own parent, hash like the transfer undo fingerprint", () => {
  const snapshot = changeSnapshot(
    "staff",
    { fields: { name: "Иванов Иван", phone: "+79990000000", weeklyDaysOff: [5, 6], extra: undefined }, parentId: "pos-1" },
    "account",
  );
  assert.deepEqual(snapshot.fields, { name: "Иванов Иван", phone: "+79990000000", weeklyDaysOff: [5, 6] });
  assert.equal(snapshot.parentId, "pos-1");
  assert.equal(snapshot.hash, rowHash("staff", snapshot.fields, "pos-1", "account"));
  // Отмена считает «сейчас» из полей, прочитанных целиком, в составе снимка: тот же отпечаток.
  assert.equal(rowHashLike("staff", snapshot.fields, "pos-1", snapshot.hash!), snapshot.hash);

  // Между аккаунтами: только ФИО, отпечаток помечен составом `f:`.
  const foreign = changeSnapshot("staff", { fields: { name: "Иванов Иван" }, parentId: "pos-1" }, "foreign");
  assert.ok(foreign.hash?.startsWith("f:"));
  assert.equal(rowHashLike("staff", { name: "Иванов Иван", phone: "+7999" }, "pos-1", foreign.hash!), foreign.hash);
  // Цех: родитель в отпечаток не входит.
  assert.equal(
    changeSnapshot("area", { fields: { name: "Цех" }, parentId: "b-1" }, "account").hash,
    changeSnapshot("area", { fields: { name: "Цех" }, parentId: null }, "account").hash,
  );
});

test("snapshot round trip through JSON; garbage dropped", () => {
  const snapshot = changeSnapshot("room", { fields: { name: "Склад", kind: "storage", sortOrder: 2, requirePhoto: false }, parentId: "b-1" }, "account");
  assert.deepEqual(parseChangeSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  // Своё зеркало созданного помещения или цеха (`mirrorId`) читается обратно; пустое — нет.
  assert.equal(parseChangeSnapshot({ ...JSON.parse(JSON.stringify(snapshot)), mirrorId: "area-1" })?.mirrorId, "area-1");
  assert.equal(Object.hasOwn(parseChangeSnapshot({ ...snapshot, mirrorId: "" })!, "mirrorId"), false);
  assert.equal(parseChangeSnapshot(null), null);
  assert.equal(parseChangeSnapshot([]), null);
  assert.equal(parseChangeSnapshot({ scope: "account" }), null);
  assert.deepEqual(parseChangeSnapshot({ scope: "weird", parentId: "", fields: { a: "x", b: { c: 1 }, d: [1, "2"], e: [3] }, hash: "" }), {
    scope: "account",
    parentId: null,
    fields: { a: "x", e: [3] },
    hash: null,
  });
});

test("source label: own side names the organization, another company sees only the cabinet", () => {
  const cabinet = { name: "Мастер-кабинет", accountId: "acc-owner" };
  // Организация владельца, источник — своя организация.
  assert.deepEqual(historySource({ viewerAccountId: "acc-owner", cabinet, source: { name: "Кафе на Ленина", accountId: "acc-owner" } }), {
    name: "Кафе на Ленина",
    cabinet: false,
    foreign: false,
  });
  // Организация владельца, источник — компания другого аккаунта: название с пометкой.
  assert.deepEqual(historySource({ viewerAccountId: "acc-owner", cabinet, source: { name: "Компания F", accountId: "acc-f" } }), {
    name: "Компания F",
    cabinet: false,
    foreign: true,
  });
  // Компания другого аккаунта: только кабинет, что бы ни было источником.
  assert.deepEqual(historySource({ viewerAccountId: "acc-f", cabinet, source: { name: "Кафе на Ленина", accountId: "acc-owner" } }), {
    name: "Мастер-кабинет",
    cabinet: true,
    foreign: true,
  });
  // Источника больше нет — кабинет.
  assert.deepEqual(historySource({ viewerAccountId: "acc-owner", cabinet, source: null }), { name: "Мастер-кабинет", cabinet: true, foreign: false });
  // Организация без аккаунта своей стороной не считается.
  assert.equal(historySource({ viewerAccountId: null, cabinet: { name: "К", accountId: null }, source: { name: "X", accountId: null } }).cabinet, true);
});

test("kept error: 409 with a reason, still a DirectoryExchangeError", () => {
  const error = new ExchangeChangeKeptError("used");
  assert.ok(error instanceof DirectoryExchangeError);
  assert.equal(error.status, 409);
  assert.equal(error.code, "change_kept");
  assert.equal(error.reason, "used");
  assert.match(error.message, /используется/);
});
