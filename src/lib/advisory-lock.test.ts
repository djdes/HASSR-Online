import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { advisoryLockKey, withAdvisoryTryLock, type AdvisoryLockClient } from "@/lib/advisory-lock";

/**
 * Фейк Postgres для транзакционной advisory-блокировки: ключ держится,
 * пока идёт «транзакция», и отпускается при её завершении — ровно как
 * `pg_try_advisory_xact_lock`.
 */
function fakeLockClient() {
  const held = new Set<string>();
  const sql: string[] = [];
  let transactions = 0;
  const client = {
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      transactions += 1;
      const mine: string[] = [];
      const tx = {
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          sql.push(strings.join("?"));
          const key = String(values[0]);
          if (held.has(key)) return [{ locked: false }];
          held.add(key);
          mine.push(key);
          return [{ locked: true }];
        },
      };
      try {
        return await fn(tx);
      } finally {
        for (const key of mine) held.delete(key);
      }
    },
  };
  return {
    client: client as unknown as AdvisoryLockClient,
    held,
    sql,
    get transactions() {
      return transactions;
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("advisoryLockKey", () => {
  it("склеивает части, пустые — прочерком", () => {
    assert.equal(advisoryLockKey("journal-period", "org-1", "hygiene", null), "journal-period:org-1:hygiene:-");
    assert.equal(advisoryLockKey("uv", "org-1", "lamp-1", "2026-10"), "uv:org-1:lamp-1:2026-10");
    assert.equal(advisoryLockKey("x", undefined, ""), "x:-:-");
  });
});

describe("withAdvisoryTryLock", () => {
  it("берёт свободную блокировку, выполняет fn и отпускает", async () => {
    const fake = fakeLockClient();
    let calls = 0;
    const result = await withAdvisoryTryLock("k1", async () => {
      calls += 1;
      assert.ok(fake.held.has("k1"), "fn выполняется под блокировкой");
      return 42;
    }, { client: fake.client, delayMs: 1 });
    assert.deepEqual(result, { acquired: true, value: 42 });
    assert.equal(calls, 1);
    assert.equal(fake.held.size, 0, "после fn блокировка отпущена");
  });

  it("транзакционная (xact) блокировка по hashtext — не сессионная", async () => {
    const fake = fakeLockClient();
    await withAdvisoryTryLock("k1", async () => null, { client: fake.client, delayMs: 1 });
    assert.match(fake.sql[0], /pg_try_advisory_xact_lock\(hashtext\(/);
  });

  it("занято дольше всех попыток — acquired:false, fn не вызывается", async () => {
    const fake = fakeLockClient();
    fake.held.add("busy");
    let calls = 0;
    const result = await withAdvisoryTryLock("busy", async () => {
      calls += 1;
      return 1;
    }, { client: fake.client, attempts: 3, delayMs: 1 });
    assert.deepEqual(result, { acquired: false });
    assert.equal(calls, 0);
    assert.equal(fake.transactions, 3, "ровно столько попыток, сколько задано");
  });

  it("два параллельных вызова с одним ключом идут по очереди, оба доходят до fn", async () => {
    const fake = fakeLockClient();
    let inside = 0;
    let maxInside = 0;
    const work = async () => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await sleep(20);
      inside -= 1;
      return "ok";
    };
    const [a, b] = await Promise.all([
      withAdvisoryTryLock("same", work, { client: fake.client, delayMs: 5 }),
      withAdvisoryTryLock("same", work, { client: fake.client, delayMs: 5 }),
    ]);
    assert.equal(a.acquired, true);
    assert.equal(b.acquired, true);
    assert.equal(maxInside, 1, "критическая секция не пересекается");
  });

  it("разные ключи не мешают друг другу", async () => {
    const fake = fakeLockClient();
    let inside = 0;
    let maxInside = 0;
    const work = async () => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await sleep(20);
      inside -= 1;
      return true;
    };
    await Promise.all([
      withAdvisoryTryLock("a", work, { client: fake.client, delayMs: 5 }),
      withAdvisoryTryLock("b", work, { client: fake.client, delayMs: 5 }),
    ]);
    assert.equal(maxInside, 2);
  });

  it("ошибка в fn пробрасывается, блокировка всё равно отпущена", async () => {
    const fake = fakeLockClient();
    await assert.rejects(
      withAdvisoryTryLock("err", async () => {
        throw new Error("boom");
      }, { client: fake.client, delayMs: 1 }),
      /boom/
    );
    assert.equal(fake.held.size, 0);
    const again = await withAdvisoryTryLock("err", async () => "second", { client: fake.client, delayMs: 1 });
    assert.deepEqual(again, { acquired: true, value: "second" });
  });
});
