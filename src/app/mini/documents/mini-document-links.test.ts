import assert from "node:assert/strict";
import test from "node:test";

import { toMiniHref } from "./mini-document-links";

test("ссылки журналов сайта получают зеркало в мини-приложении", () => {
  assert.equal(toMiniHref("/journals"), "/mini/journals");
  assert.equal(toMiniHref("/journals/hygiene"), "/mini/journals/hygiene");
  assert.equal(toMiniHref("/journals/hygiene/documents/abc123"), "/mini/documents/abc123");
  assert.equal(toMiniHref("/journals/hygiene?tab=closed"), "/mini/journals/hygiene?tab=closed");
  assert.equal(toMiniHref("/journals/hygiene/documents/abc#row-3"), "/mini/documents/abc#row-3");
});

test("ссылки без зеркала не трогаем", () => {
  assert.equal(toMiniHref("/settings/equipment"), null);
  assert.equal(toMiniHref("/journals/hygiene/new"), null);
  assert.equal(toMiniHref("/mini/journals"), null);
  assert.equal(toMiniHref("/api/journal-documents/abc/pdf"), null);
});
