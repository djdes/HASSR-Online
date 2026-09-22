import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  enqueueOutbox,
  outboxHeaderKey,
  parseCreateTaskPayload,
  type OutboxClientLike,
} from "@/lib/tasksflow-outbox-actions";

type Row = {
  id: string;
  idempotencyKey: string;
  status: "pending" | "delivered" | "failed";
  payload: unknown;
  attempts: number;
  lastError: string | null;
  deliveredAt: Date | null;
  lastAttemptAt: Date | null;
};

function fakeClient() {
  const rows = new Map<string, Row>();
  let seq = 0;
  const client: OutboxClientLike = {
    tasksFlowOutbox: {
      async createMany(args) {
        let count = 0;
        for (const item of args.data) {
          if (rows.has(item.idempotencyKey)) continue;
          seq += 1;
          rows.set(item.idempotencyKey, {
            id: `o${seq}`,
            idempotencyKey: item.idempotencyKey,
            status: "pending",
            payload: item.payload,
            attempts: 0,
            lastError: null,
            deliveredAt: null,
            lastAttemptAt: null,
          });
          count += 1;
        }
        return { count };
      },
      async findUnique(args) {
        const row = rows.get(args.where.idempotencyKey);
        return row ? { id: row.id, status: row.status, payload: row.payload } : null;
      },
      async update(args) {
        const row = [...rows.values()].find((item) => item.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
    },
  };
  return { client, rows };
}

const payload = {
  journalCode: "general_cleaning",
  documentId: "doc1",
  rowKey: "gc::r1::2026-09-25",
  rowId: "r1",
  dateKey: "2026-09-25",
  task: { title: "Генеральная уборка · Кухня · 25.09 (пт)", workerId: 11, isRecurring: false },
};

const input = {
  integrationId: "int1",
  organizationId: "org1",
  idempotencyKey: "gc-create::doc1::r1::2026-09-25",
  action: "createTask" as const,
  payload,
};

describe("enqueueOutbox", () => {
  it("первый раз — в очередь, повтор — уже в очереди", async () => {
    const { client, rows } = fakeClient();
    assert.equal(await enqueueOutbox(client, input), "queued");
    assert.equal(await enqueueOutbox(client, input), "exists");
    assert.equal(rows.size, 1);
  });

  it("доставленная команда без ссылки — снова в очередь, новое поколение", async () => {
    const { client, rows } = fakeClient();
    await enqueueOutbox(client, input);
    const row = rows.get(input.idempotencyKey)!;
    Object.assign(row, { status: "delivered", attempts: 1, deliveredAt: new Date() });
    assert.equal(await enqueueOutbox(client, input, { requeue: true }), "requeued");
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, 0);
    assert.equal(row.deliveredAt, null);
    assert.equal((row.payload as { generation: number }).generation, 1);
    assert.equal(outboxHeaderKey(row.idempotencyKey, row.payload), "gc-create::doc1::r1::2026-09-25#g1");
  });

  it("ожидающая — обновляем полезную нагрузку, если исполнитель сменился", async () => {
    const { client, rows } = fakeClient();
    await enqueueOutbox(client, input);
    const changed = { ...input, payload: { ...payload, task: { ...payload.task, workerId: 22 } } };
    assert.equal(await enqueueOutbox(client, changed, { requeue: true }), "refreshed");
    assert.equal((rows.get(input.idempotencyKey)!.payload as typeof payload).task.workerId, 22);
    assert.equal(await enqueueOutbox(client, changed, { requeue: true }), "exists");
  });

  it("проваленная — повторяем только с другой нагрузкой", async () => {
    const { client, rows } = fakeClient();
    await enqueueOutbox(client, input);
    rows.get(input.idempotencyKey)!.status = "failed";
    assert.equal(await enqueueOutbox(client, input, { requeue: true }), "exists");
    const changed = { ...input, payload: { ...payload, task: { ...payload.task, workerId: 22 } } };
    assert.equal(await enqueueOutbox(client, changed, { requeue: true }), "requeued");
    assert.equal(rows.get(input.idempotencyKey)!.status, "pending");
  });
});

describe("parseCreateTaskPayload / outboxHeaderKey", () => {
  it("валидная нагрузка", () => {
    assert.deepEqual(parseCreateTaskPayload(payload), payload);
  });

  it("битая нагрузка — null", () => {
    assert.equal(parseCreateTaskPayload(null), null);
    assert.equal(parseCreateTaskPayload({ ...payload, task: { title: "", workerId: 1 } }), null);
    assert.equal(parseCreateTaskPayload({ ...payload, task: { title: "x", workerId: "1" } }), null);
    assert.equal(parseCreateTaskPayload({ ...payload, documentId: 5 }), null);
  });

  it("ключ заголовка без поколения — сам ключ", () => {
    assert.equal(outboxHeaderKey("k", payload), "k");
    assert.equal(outboxHeaderKey("k", { generation: 0 }), "k");
    assert.equal(outboxHeaderKey("k", { generation: 2 }), "k#g2");
  });
});
