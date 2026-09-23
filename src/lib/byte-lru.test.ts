import assert from "node:assert/strict";
import test from "node:test";

import { ByteLru } from "@/lib/byte-lru";

test("LRU вытесняет самые старые записи при превышении объёма", () => {
  const lru = new ByteLru<string>(10);
  lru.set("a", "a", 4);
  lru.set("b", "b", 4);
  lru.get("a"); // a — свежая
  lru.set("c", "c", 4); // 12 > 10 → уходит b
  assert.equal(lru.get("b"), undefined);
  assert.equal(lru.get("a"), "a");
  assert.equal(lru.get("c"), "c");
  assert.equal(lru.bytes, 8);
});

test("перезапись ключа пересчитывает объём", () => {
  const lru = new ByteLru<string>(10);
  lru.set("a", "a", 4);
  lru.set("a", "A", 6);
  assert.equal(lru.bytes, 6);
  assert.equal(lru.get("a"), "A");
});

test("запись больше лимита не кладётся", () => {
  const lru = new ByteLru<string>(10);
  lru.set("big", "x", 11);
  assert.equal(lru.get("big"), undefined);
  assert.equal(lru.bytes, 0);
});

test("resize увеличивает объём существующей записи и вытесняет соседей", () => {
  const lru = new ByteLru<string>(10);
  lru.set("a", "a", 4);
  lru.set("b", "b", 4);
  lru.resize("b", 8);
  assert.equal(lru.get("a"), undefined);
  assert.equal(lru.bytes, 8);
});
