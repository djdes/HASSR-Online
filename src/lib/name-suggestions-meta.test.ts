import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSuggestionMeta, suggestionKey } from "./name-suggestions";

describe("name-suggestions meta", () => {
  it("keeps only a non-empty productTemp, trimmed and capped", () => {
    assert.equal(normalizeSuggestionMeta(null), null);
    assert.equal(normalizeSuggestionMeta("x"), null);
    assert.equal(normalizeSuggestionMeta({ productTemp: "   " }), null);
    assert.deepEqual(normalizeSuggestionMeta({ productTemp: " 75 " }), { productTemp: "75" });
    assert.equal(normalizeSuggestionMeta({ productTemp: "1".repeat(40) })?.productTemp?.length, 20);
    assert.equal(normalizeSuggestionMeta({ other: 1 }), null);
  });

  it("matches names case- and whitespace-insensitively", () => {
    assert.equal(suggestionKey("  Борщ   украинский "), "борщ украинский");
    assert.equal(suggestionKey("БОРЩ украинский"), suggestionKey("борщ Украинский"));
  });
});
