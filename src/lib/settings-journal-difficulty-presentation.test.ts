import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { loadMessages } from "@/i18n/messages";
import {
  difficultyCopyKeys,
  journalDifficultyDisplayName,
  journalDifficultyFrequencyCount,
  journalDifficultyFrequencyKey,
  journalDifficultySaveError,
} from "./settings-journal-difficulty-presentation";

test("managed descriptors require own finite codes at the expected status", () => {
  assert.equal(journalDifficultySaveError({ errorCode: "JOURNAL_DIFFICULTY_FORBIDDEN" }, 403), "errors.forbidden");
  assert.equal(journalDifficultySaveError({ errorCode: "JOURNAL_DIFFICULTY_INVALID_BODY" }, 400), "errors.invalidBody");
  for (const code of ["constructor", "__proto__", "unknown", null, 7]) {
    assert.equal(journalDifficultySaveError({ errorCode: code }, 403), "errors.saveFailed");
  }
  assert.equal(journalDifficultySaveError({ errorCode: "JOURNAL_DIFFICULTY_FORBIDDEN" }, 400), "errors.saveFailed");
  assert.equal(journalDifficultySaveError(Object.create({ errorCode: "JOURNAL_DIFFICULTY_FORBIDDEN" }), 400), "errors.invalidBody");
  const accessor = Object.defineProperty({}, "errorCode", { get() { throw new Error("must not invoke accessor"); } });
  assert.equal(journalDifficultySaveError(accessor, 403), "errors.saveFailed");
  for (const data of [null, [], "raw custom error", 1]) assert.equal(journalDifficultySaveError(data, 403), "errors.saveFailed");
  assert.equal(journalDifficultySaveError({ error: "legacy wire message" }, 403), "errors.forbidden");
  assert.equal(journalDifficultySaveError({ error: "legacy wire message" }, 400), "errors.invalidBody");
  assert.equal(journalDifficultySaveError(null, 401), "errors.unauthorized");
  assert.equal(journalDifficultySaveError({ error: "do not translate arbitrary text" }, 500), "errors.saveFailed");
});

test("display translates only an exact official name and never custom or unknown data", async () => {
  const journal = ACTIVE_JOURNAL_CATALOG[0];
  const names = (await loadMessages("en")).journals.names;
  const original = { code: journal.code, name: journal.name };
  assert.notEqual(names[journal.code], journal.name);
  assert.equal(journalDifficultyDisplayName("en", names, original), names[journal.code]);
  assert.equal(journalDifficultyDisplayName("ru", names, original), journal.name);
  for (const name of ["RAW <custom>", "", "\u041c\u043e\u0439 \u0436\u0443\u0440\u043d\u0430\u043b"]) {
    assert.equal(journalDifficultyDisplayName("uz", names, { code: journal.code, name }), name);
  }
  for (const code of ["unknown", "constructor", "__proto__"]) {
    assert.equal(journalDifficultyDisplayName("en", names, { code, name: "RAW" }), "RAW");
  }
  assert.deepEqual(original, { code: journal.code, name: journal.name });
});

test("half-per-month is precise and other empirical boundaries retain legacy categories", () => {
  assert.equal(journalDifficultyFrequencyKey(0.5), "frequency.timesPerMonth");
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(journalDifficultyFrequencyCount(locale, 0.5), new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 1 }).format(0.5));
    assert.equal(journalDifficultyFrequencyCount(locale, 8), "8");
    assert.equal(journalDifficultyFrequencyCount(locale, 12500), "12500");
  }
  for (const [frequency, key] of [[0.25, "rare"], [0.3, "quarterly"], [0.33, "quarterly"], [0.9, "monthly"], [1, "monthly"], [3, "weekly"], [6, "timesPerMonth"], [18, "weekdays"], [28, "daily"]] as const) {
    assert.equal(journalDifficultyFrequencyKey(frequency), "frequency." + key);
  }
  for (const level of [1, 2, 3, 4, 5] as const) assert.equal(difficultyCopyKeys(level)?.label, `levels.${level}.label`);
  assert.equal(difficultyCopyKeys("constructor" as never), undefined);
});
