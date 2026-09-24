import assert from "node:assert/strict";
import test from "node:test";

import { isUntouchedDisabledCodes } from "@/lib/health-check-default-off";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import {
  NEW_JOURNAL_CODES_2026_09,
  applyNewJournalsDefaultOff,
} from "@/lib/new-journals-default-off";

test("новые коды есть в каталоге", () => {
  const catalog = new Set<string>(ACTIVE_JOURNAL_CATALOG.map((item) => item.code));
  for (const code of NEW_JOURNAL_CODES_2026_09) {
    assert.ok(catalog.has(code), code);
  }
});

test("пустой список: все новые коды выключаются", () => {
  const result = applyNewJournalsDefaultOff([]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.disabledJournalCodes, [...NEW_JOURNAL_CODES_2026_09]);
});

test("существующие выключенные сохраняются в прежнем порядке, дублей нет", () => {
  const result = applyNewJournalsDefaultOff(["fryer_oil", "pool_water_control", "health_check"]);
  assert.deepEqual(result.disabledJournalCodes.slice(0, 3), ["fryer_oil", "pool_water_control", "health_check"]);
  assert.equal(new Set(result.disabledJournalCodes).size, result.disabledJournalCodes.length);
  assert.ok(!result.added.includes("pool_water_control"));
});

test("повторный прогон ничего не меняет", () => {
  const first = applyNewJournalsDefaultOff(["cleaning"]);
  const second = applyNewJournalsDefaultOff(first.disabledJournalCodes);
  assert.equal(second.changed, false);
  assert.deepEqual(second.disabledJournalCodes, first.disabledJournalCodes);
});

test("мусор в поле не ломает применение", () => {
  const result = applyNewJournalsDefaultOff({ not: "array" });
  assert.equal(result.changed, true);
  assert.equal(result.disabledJournalCodes.length, NEW_JOURNAL_CODES_2026_09.length);
});

test("список, выключенный сидером, остаётся «нетронутым» для анкеты", () => {
  const seeded = applyNewJournalsDefaultOff(["health_check"]).disabledJournalCodes;
  assert.equal(isUntouchedDisabledCodes(seeded), true);
  assert.equal(isUntouchedDisabledCodes([...seeded, "cleaning"]), false);
});
