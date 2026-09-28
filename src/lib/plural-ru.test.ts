import assert from "node:assert/strict";
import test from "node:test";

import { pluralRu } from "./plural-ru";

test("журнал, журнала, журналов — по последним цифрам числа", () => {
  const word = (n: number) => pluralRu(n, "журнал", "журнала", "журналов");
  assert.equal(word(1), "журнал");
  assert.equal(word(3), "журнала");
  assert.equal(word(5), "журналов");
  assert.equal(word(11), "журналов");
  assert.equal(word(14), "журналов");
  assert.equal(word(21), "журнал");
  assert.equal(word(22), "журнала");
  assert.equal(word(112), "журналов");
});
