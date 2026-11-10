import assert from "node:assert/strict";
import { test } from "node:test";

import { acquireRowLock, activeRowLocks, rowLockKey } from "./row-lock";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("the second request for the same row waits for the first", async () => {
  const key = rowLockKey("doc", "row", "2026-11-10");
  const order: string[] = [];
  const first = await acquireRowLock(key);
  const second = acquireRowLock(key).then((release) => {
    order.push("second in");
    release();
  });
  await tick();
  order.push("first still working");
  first();
  await second;
  assert.deepEqual(order, ["first still working", "second in"]);
  assert.equal(activeRowLocks(), 0);
});

test("different rows do not wait for each other; release is idempotent", async () => {
  const a = await acquireRowLock("a");
  const b = await acquireRowLock("b");
  assert.equal(activeRowLocks(), 2);
  a();
  a();
  b();
  assert.equal(activeRowLocks(), 0);
});

test("three requests run strictly one after another", async () => {
  let running = 0;
  let maxRunning = 0;
  const work = async () => {
    const release = await acquireRowLock("same");
    running++;
    maxRunning = Math.max(maxRunning, running);
    await tick();
    running--;
    release();
  };
  await Promise.all([work(), work(), work()]);
  assert.equal(maxRunning, 1);
  assert.equal(activeRowLocks(), 0);
});
