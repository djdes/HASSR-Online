import test from "node:test";
import assert from "node:assert/strict";

import { NORM_CATALOG } from "./norm-catalog";

test("id каталога уникальны, у каждого записи есть название", () => {
  const ids = NORM_CATALOG.map((doc) => doc.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const doc of NORM_CATALOG) {
    assert.ok(doc.title.trim().length > 0, doc.id);
    assert.equal(typeof doc.recommended, "boolean", doc.id);
  }
});

test("состав каталога: 14 документов, 10 рекомендуемых", () => {
  assert.equal(NORM_CATALOG.length, 14);
  assert.equal(NORM_CATALOG.filter((doc) => doc.recommended).length, 10);
  assert.ok(NORM_CATALOG.find((doc) => doc.id === "sanpin-4282")?.recommended);
  assert.equal(NORM_CATALOG.find((doc) => doc.id === "trts-033")?.recommended, false);
});
