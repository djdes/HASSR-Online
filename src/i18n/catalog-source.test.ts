import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogSource } from "../../scripts/lib/catalog-source.mjs";

test("raw catalog validation rejects duplicate keys before JSON can silently discard messages", () => {
  assert.throws(() => parseCatalogSource('{"draft":{"recently":"Recently"},"draft":{"continue":"Continue"}}'), /Duplicate catalog key draft/);
  assert.throws(() => parseCatalogSource('{"a":{"label":"One","label":"Two"}}'), /Duplicate catalog key label/);
  assert.deepEqual(parseCatalogSource('{"a":{"label":"One"},"b":{"label":"Two"}}'), { a: { label: "One" }, b: { label: "Two" } });
});
