import assert from "node:assert/strict";
import test from "node:test";
import type { IdempotencyStore, StoredResponse } from "@/lib/idempotency";
import { restIdempotencyKey, runIdempotent } from "./idempotency";

function memoryStore() {
  const rows = new Map<string, StoredResponse>();
  const store: IdempotencyStore = {
    async create(row) {
      if (rows.has(row.key)) throw new Error("unique violation");
      rows.set(row.key, { httpStatus: row.httpStatus, response: row.response });
    },
    async find(key) {
      return rows.get(key) ?? null;
    },
    async complete(key, value) {
      rows.set(key, value);
    },
    async release(key) {
      rows.delete(key);
    },
  };
  return { store, rows };
}

test("restIdempotencyKey: ключ привязан к ключу API и инструменту; пустой заголовок — без идемпотентности", () => {
  assert.equal(restIdempotencyKey("key1", "add_employee", " abc "), "v1:key1:add_employee:abc");
  assert.notEqual(restIdempotencyKey("key1", "add_employee", "abc"), restIdempotencyKey("key1", "fill_journal_cells", "abc"));
  assert.equal(restIdempotencyKey("key1", "add_employee", null), null);
  assert.equal(restIdempotencyKey("key1", "add_employee", "   "), null);
});

test("два одновременных запроса с одним ключом: работа выполняется один раз, второй получает 409", async () => {
  const { store } = memoryStore();
  let calls = 0;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const run = async () => {
    calls += 1;
    await gate;
    return { status: 200, body: { ok: true, data: { n: calls } } };
  };
  const first = runIdempotent({ store, key: "v1:k:t:same", organizationId: "org1", run });
  await new Promise((r) => setTimeout(r, 5));
  const second = await runIdempotent({ store, key: "v1:k:t:same", organizationId: "org1", run });
  finish();
  const done = await first;
  assert.equal(calls, 1);
  assert.equal(done.status, 200);
  assert.equal(second.status, 409);
  assert.equal(second.inFlight, true);
});

test("повтор после успеха отдаёт сохранённый ответ с replayed, работа не выполняется", async () => {
  const { store } = memoryStore();
  let calls = 0;
  const run = async () => ({ status: 200, body: { ok: true, data: { n: ++calls } } });
  await runIdempotent({ store, key: "v1:k:t:a", organizationId: "org1", run });
  const again = await runIdempotent({ store, key: "v1:k:t:a", organizationId: "org1", run });
  assert.equal(calls, 1);
  assert.deepEqual(again, { status: 200, body: { ok: true, data: { n: 1 } }, replayed: true });
});

test("ошибка или неуспешный статус снимают бронь — повтор выполняет работу снова", async () => {
  const { store, rows } = memoryStore();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    return { status: 422, body: { ok: false, error: "нет" } };
  };
  await runIdempotent({ store, key: "v1:k:t:b", organizationId: "org1", run: failing });
  assert.equal(rows.has("v1:k:t:b"), false);
  await assert.rejects(
    runIdempotent({ store, key: "v1:k:t:b", organizationId: "org1", run: async () => { calls += 1; throw new Error("boom"); } })
  );
  assert.equal(rows.has("v1:k:t:b"), false);
  await runIdempotent({ store, key: "v1:k:t:b", organizationId: "org1", run: failing });
  assert.equal(calls, 3);
});

test("без ключа — просто выполняет работу", async () => {
  const { store, rows } = memoryStore();
  const res = await runIdempotent({ store, key: null, organizationId: "org1", run: async () => ({ status: 200, body: { ok: true } }) });
  assert.deepEqual(res, { status: 200, body: { ok: true }, replayed: false });
  assert.equal(rows.size, 0);
});
