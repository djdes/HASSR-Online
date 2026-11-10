import assert from "node:assert/strict";
import { test } from "node:test";

import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { MEMO_PRINT, memoDensity } from "@/lib/journals-memo";
import ru from "@/i18n/messages/ru.json";

test("memoDensity: the more journals, the tighter the sheet", () => {
  assert.equal(memoDensity(0), "roomy");
  assert.equal(memoDensity(16), "roomy");
  assert.equal(memoDensity(17), "normal");
  assert.equal(memoDensity(26), "normal");
  assert.equal(memoDensity(27), "compact");
  assert.equal(memoDensity(36), "compact");
  assert.equal(memoDensity(37), "dense");
  assert.equal(memoDensity(ACTIVE_JOURNAL_CATALOG.length), "dense");
});

test("print gets tighter with every density step", () => {
  const order = ["roomy", "normal", "compact", "dense"] as const;
  for (let index = 1; index < order.length; index += 1) {
    const looser = MEMO_PRINT[order[index - 1]];
    const tighter = MEMO_PRINT[order[index]];
    assert.ok(tighter.fontPt < looser.fontPt);
    assert.ok(tighter.padMm < looser.padMm);
    assert.ok(tighter.lineHeight <= looser.lineHeight);
  }
  // Меньше 7pt на бумаге уже не прочитать.
  assert.ok(MEMO_PRINT.dense.fontPt >= 7);
});

test("the memo has a filling rule for every catalog journal", () => {
  const periodicity = ru.journalWidgets.periodicity as Record<string, string>;
  for (const journal of ACTIVE_JOURNAL_CATALOG) {
    assert.ok(periodicity[journal.code]?.trim(), `no periodicity text for ${journal.code}`);
  }
  assert.ok(periodicity.fallback.trim());
});
