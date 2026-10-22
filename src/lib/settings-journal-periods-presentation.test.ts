import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMessages } from "@/i18n/messages";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { journalPeriodsDisplayName, journalPeriodsSaveError, PERIOD_KIND_KEYS } from "./settings-journal-periods-presentation";

test("period error presentation accepts only own finite descriptors and matching statuses", () => {
  assert.equal(journalPeriodsSaveError({ errorCode: "JOURNAL_PERIODS_INVALID_DAYS" }, 400), "feedback.invalidDays");
  assert.equal(journalPeriodsSaveError({ errorCode: "JOURNAL_PERIODS_INVALID_DAYS" }, 403), "feedback.saveFailed");
  for (const value of ["__proto__", "constructor", "toString", "JOURNAL_PERIODS_UNKNOWN", null, {}]) assert.equal(journalPeriodsSaveError({ errorCode: value }, 400), "feedback.saveFailed");
  assert.equal(journalPeriodsSaveError({ get errorCode() { throw Error("must not invoke getters"); } }, 400), "feedback.saveFailed");
  assert.equal(journalPeriodsSaveError(Object.create({ errorCode: "JOURNAL_PERIODS_INVALID_DAYS" }), 400), "feedback.invalidBody");
  assert.equal(journalPeriodsSaveError({}, 403), "feedback.forbidden");
  assert.equal(journalPeriodsSaveError(null, 401), "feedback.unauthorized");
  for (const value of [null, [], 0, "external diagnostic"]) assert.equal(journalPeriodsSaveError(value, 500), "feedback.saveFailed");
});
test("period journal names translate only exact official names and preserve custom raw values", async () => {
  const messages = await loadMessages("en");
  const journal = ACTIVE_JOURNAL_CATALOG.find((item) => Object.hasOwn(messages.journals.names, item.code));
  assert.ok(journal);
  assert.equal(journalPeriodsDisplayName("en", messages.journals.names, journal), messages.journals.names[journal.code as keyof typeof messages.journals.names]);
  assert.equal(journalPeriodsDisplayName("ru", messages.journals.names, journal), journal.name);
  for (const name of ["Custom title", "", "  keep spaces  ", "Name from user"]) assert.equal(journalPeriodsDisplayName("en", messages.journals.names, { ...journal, name }), name);
  for (const code of ["unknown", "__proto__", "constructor"]) assert.equal(journalPeriodsDisplayName("en", messages.journals.names, { code, name: "Literal" }), "Literal");
});
test("period labels are complete stable presentation keys for the six persisted kinds", () => {
  assert.deepEqual(Object.keys(PERIOD_KIND_KEYS), ["monthly", "yearly", "half-monthly", "single-day", "perpetual", "days"]);
  assert.equal(Object.hasOwn(PERIOD_KIND_KEYS, "constructor"), false);
});
