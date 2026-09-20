import assert from "node:assert/strict";
import test from "node:test";

import { positionMatchKey, positionSuggestionsFor } from "@/lib/sphere-positions";

test("род и регистр на сравнение не влияют", () => {
  assert.equal(
    positionMatchKey("Заведующая производством"),
    positionMatchKey("заведующий производством")
  );
  assert.equal(positionMatchKey("Уборщица"), positionMatchKey("уборщик"));
  assert.equal(positionMatchKey("Старшая смены"), positionMatchKey("Старший смены"));
});

test("разные должности не склеиваются", () => {
  assert.notEqual(positionMatchKey("Повар"), positionMatchKey("Кондитер"));
  assert.notEqual(
    positionMatchKey("Заведующая производством"),
    positionMatchKey("Заведующая складом")
  );
});

test("заведённую «Заведующую производством» второй раз не предлагаем", () => {
  const suggestions = positionSuggestionsFor("restaurant", "management", [
    "Заведующая производством",
  ]);
  assert.ok(
    !suggestions.some(
      (name) => positionMatchKey(name) === positionMatchKey("Заведующий производством")
    ),
    `не должно предлагаться: ${suggestions.join(", ")}`
  );
});
