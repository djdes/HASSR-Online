import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareTranslationInventory } from "../../scripts/lib/i18n-translation-preparation";

test("translation preparation reuses exact text while retaining all contexts and stable review identities", () => {
  const input = [
    { file: "a.tsx", line: 1, kind: "JsxText", text: "Сохранить" },
    { file: "b.tsx", line: 2, kind: "StringLiteral", text: "Сохранить" },
    { file: "c.tsx", line: 3, kind: "StringLiteral", text: " Сохранить " },
  ];
  const result = prepareTranslationInventory(input, [{ source: "Сохранить", locale: "en", text: "Save", origin: "common.save" }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].occurrences.length, 2);
  assert.equal(result[0].suggestions[0].text, "Save");
  assert.equal(result[1].suggestions.length, 0);
  assert.deepEqual(prepareTranslationInventory(input.slice(0, 1), [])[0].id, result[0].id);
  assert.equal(result[0].status, "NEEDS_CONTEXT_REVIEW");
});

test("ambiguous translations and template fragments cannot appear as approved copy", () => {
  const result = prepareTranslationInventory([
    { file: "a.tsx", line: 1, kind: "TemplateHead", text: "Печать " },
  ], [
    { source: "Печать ", locale: "en", text: "Print", origin: "action" },
    { source: "Печать ", locale: "en", text: "Seal", origin: "document" },
    { source: "Печать ", locale: "en", text: "Seal", origin: "document" },
    { source: "Печать ", locale: "uz", text: "", origin: "empty" },
  ]);
  assert.equal(result[0].fragment, true);
  assert.deepEqual(result[0].conflicts, ["en"]);
  assert.equal(result[0].suggestions.length, 2);
  assert.equal(result[0].status, "NEEDS_CONTEXT_REVIEW");
});
