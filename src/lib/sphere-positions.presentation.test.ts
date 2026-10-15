import assert from "node:assert/strict";
import test from "node:test";

import { positionSuggestionOptionsFor } from "@/lib/sphere-positions";

test("position suggestion IDs are stable and preserve original source names", () => {
  assert.deepEqual(positionSuggestionOptionsFor("restaurant", "management", []).slice(0, 3), [
    { id: "position_001", name: "Управляющий" },
    { id: "position_002", name: "Шеф-повар" },
    { id: "position_003", name: "Су-шеф" },
  ]);
});
