import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeMasterMenuMeta, normalizeSuggestionMeta, suggestionKey } from "./name-suggestions";

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

  it("passes menu portionWeight and productionTime (normalized), drops junk", () => {
    assert.deepEqual(normalizeSuggestionMeta({ portionWeight: "  200/10 ", productionTime: "8.0" }), {
      portionWeight: "200/10",
      productionTime: "08:00",
    });
    assert.equal(normalizeSuggestionMeta({ portionWeight: "   ", productionTime: "утром" }), null);
    assert.deepEqual(normalizeSuggestionMeta({ productTemp: "75", productionTime: 830 }), { productTemp: "75" });
  });

  it("master menu meta goes under the kitchen's own values", () => {
    assert.deepEqual(mergeMasterMenuMeta({ productTemp: "75" }, { portion: "250", time: "08:30" }), {
      productTemp: "75",
      portionWeight: "250",
      productionTime: "08:30",
    });
    assert.deepEqual(
      mergeMasterMenuMeta({ portionWeight: "300", productionTime: "10:00" }, { portion: "250", time: "08:30" }),
      { portionWeight: "300", productionTime: "10:00" }
    );
    // Меню без выхода/времени — meta прежняя (нет мастера / старое меню).
    assert.deepEqual(mergeMasterMenuMeta({ productTemp: "75" }, { portion: null, time: null }), { productTemp: "75" });
    assert.equal(mergeMasterMenuMeta(undefined, {}), null);
  });
});
