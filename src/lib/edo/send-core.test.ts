import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { edoStatusKind, edoStatusTone, edoWaitsSender, isEdoDead, isEdoSettled, sabyStateCodeToInt, sabyStateKind } from "./saby/status";
import { decideAfterReread, decideDuplicate, type EdoDupCandidate } from "./send-core";

const row = (over: Partial<EdoDupCandidate> = {}): EdoDupCandidate => ({
  id: "r1",
  sabyDocId: "g1",
  cabinetClientId: "c1",
  stateCode: 0,
  deletedAt: null,
  error: null,
  number: "42",
  createdAt: "2026-10-28T10:00:00Z",
  ...over,
});

describe("decideDuplicate", () => {
  test("нет прежних или все мёртвые — новый документ", () => {
    assert.deepEqual(decideDuplicate([], "c1"), { action: "create" });
    const dead = [row({ stateCode: 9 }), row({ id: "r2", stateCode: 22 }), row({ id: "r3", stateCode: 6 }), row({ id: "r4", deletedAt: new Date() })];
    assert.deepEqual(decideDuplicate(dead, "c1"), { action: "create" });
  });

  test("живой в том же кабинете — перечитать самый свежий", () => {
    const d = decideDuplicate([row({ id: "old", createdAt: "2026-10-01T00:00:00Z" }), row({ id: "new", stateCode: 3, createdAt: "2026-10-28T00:00:00Z" })], "c1");
    assert.equal(d.action, "reuse");
    assert.equal(d.action === "reuse" && d.row.id, "new");
    // Запись не прошла (код пустой) — тоже живой: перечитать по GUID, ответ мог потеряться.
    assert.equal(decideDuplicate([row({ stateCode: null, error: "сбой" })], "c1").action, "reuse");
  });

  test("живой в другом кабинете — отказ, второй не создаём", () => {
    assert.equal(decideDuplicate([row({ cabinetClientId: "old-cabinet" })], "c1").action, "conflict");
  });
});

describe("decideAfterReread", () => {
  test("черновик — перезапись тем же GUID; не записывался и нет в Saby — тоже", () => {
    assert.deepEqual(decideAfterReread(0, { code: "0" }), { action: "rewrite" });
    assert.deepEqual(decideAfterReread(null, null), { action: "rewrite" });
  });

  test("был записан и пропал — удалён руками, нужен новый", () => {
    assert.deepEqual(decideAfterReread(0, null), { action: "create", markDeleted: true });
  });

  test("отправлен/доставлен/подписан/незнакомый код — отказ; отклонён/аннулирован/ошибка — новый", () => {
    for (const code of ["3", "4", "7", "10", "23", "99", ""]) assert.deepEqual(decideAfterReread(0, { code }), { action: "conflict" }, code);
    for (const code of ["6", "9", "22"]) assert.deepEqual(decideAfterReread(3, { code }), { action: "create", markDeleted: false }, code);
  });
});

describe("статусы строки истории", () => {
  test("виды, тон и «ждёт отправителя»", () => {
    assert.equal(edoStatusKind({ stateCode: null, deletedAt: null, error: null }), "writing");
    assert.equal(edoStatusKind({ stateCode: null, deletedAt: null, error: "сбой" }), "not_written");
    assert.equal(edoStatusKind({ stateCode: 0, deletedAt: "2026-10-29", error: null }), "deleted");
    assert.equal(edoStatusKind({ stateCode: 0, deletedAt: null, error: null }), "draft");
    assert.ok(edoWaitsSender("draft"));
    assert.equal(edoStatusTone("draft"), "wait");
    assert.equal(edoStatusTone("done"), "ok");
    assert.equal(edoStatusTone("rejected"), "bad");
    assert.equal(sabyStateKind(23), "waiting_sign");
    assert.equal(sabyStateKind("x"), "unknown");
    assert.equal(sabyStateCodeToInt(" 7 "), 7);
    assert.equal(sabyStateCodeToInt(""), null);
  });

  test("окончательные и мёртвые", () => {
    assert.ok(isEdoSettled({ stateCode: 7, deletedAt: null, error: null }));
    assert.equal(isEdoSettled({ stateCode: 6, deletedAt: null, error: null }), false);
    assert.ok(isEdoDead({ stateCode: 6, deletedAt: null, error: null }));
    assert.equal(isEdoDead({ stateCode: 7, deletedAt: null, error: null }), false);
    assert.equal(isEdoDead({ stateCode: null, deletedAt: null, error: "сбой" }), false);
  });
});
