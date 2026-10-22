import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTranslator } from "use-intl/core";
import type { Messages } from "@/i18n/messages";
import { presentTodayError, readTodayError, todayApiError, todayCaughtError, todayDayLabel, todayJournalLabel, todaySchedule } from "./today-presentation";

const directory = process.env.MINI_TODAY_CATALOG_DIR ?? path.join(process.cwd(), "src/i18n/messages");
test("calendar compatibility preserves Today date keys and validated absence bounds", () => {
  assert.equal(todayDayLabel("2026-10-16", "uz", true), "juma, 16-oktabr");
  assert.equal(todayDayLabel("2027-01-01", "uz"), "1-yanvar");
  assert.equal(todayDayLabel("invalid", "uz"), "invalid");
  const messages = JSON.parse(fs.readFileSync(path.join(directory, "uz.json"), "utf8")) as Messages;
  const t = createTranslator({ locale: "uz", messages, namespace: "miniToday" });
  assert.equal(todaySchedule(t, "uz", "vacation", { kind: "vacation", text: "CUSTOM", untilKey: "2026-10-31" }), t("schedule.vacationUntil", { date: "31/10" }));
  assert.equal(todaySchedule(t, "uz", "vacation", { kind: "vacation", text: "CUSTOM", untilKey: "2026-02-31" }), "CUSTOM");
});
for (const locale of ["ru", "en", "uz"] as const) {
  const messages = JSON.parse(fs.readFileSync(path.join(directory, locale + ".json"), "utf8")) as Messages;
  const t = createTranslator({ locale, messages, namespace: "miniToday" });
  test(`${locale}: proven short labels and literal custom-identical/unknown labels`, () => {
    for (const [code, translated] of Object.entries(messages.miniToday.groups)) {
      assert.equal(todayJournalLabel(t, code, "CUSTOM", "builtin"), translated);
      assert.equal(todayJournalLabel(t, code, "Гигиена", "literal"), "Гигиена");
      assert.equal(todayJournalLabel(t, code, "Гигиена"), "Гигиена");
    }
    for (const code of ["__proto__", "constructor", "unknown"]) assert.equal(todayJournalLabel(t, code, "CUSTOM", "builtin"), "CUSTOM");
  });
  test(`${locale}: schedule provenance, aliases and literal old end-date note`, () => {
    for (const [kind, key] of [["sick", "sick"], ["sick_leave", "sick"], ["vacation", "vacation"], ["off", "off"], ["day_off", "off"]] as const) {
      assert.equal(todaySchedule(t, locale, kind), t(`schedule.${key}`));
      assert.equal(todaySchedule(t, locale, "off", { kind, text: "CUSTOM", untilKey: null }), t(`schedule.${key}`));
      assert.ok(todaySchedule(t, locale, null, { kind, text: "CUSTOM", untilKey: "2026-09-25" })?.includes("25"));
    }
    for (const untilKey of [undefined, "2026-02-30", "INVALID"]) assert.equal(todaySchedule(t, locale, "off", { kind: "vacation", text: "CUSTOM until 25.09", ...(untilKey === undefined ? {} : { untilKey }) }), "CUSTOM until 25.09");
    assert.equal(todaySchedule(t, locale, "constructor"), null);
    assert.equal(todaySchedule(t, locale, "off", { kind: "unknown", text: "CUSTOM" }), "CUSTOM");
    assert.equal(todayDayLabel("bad", locale), "bad");
    assert.ok(todayDayLabel("2026-10-16", locale, true).includes("16"));
  });
  test(`${locale}: reason descriptors preserve active task, never arbitrary server text`, async () => {
    const reasons = ["taken_by_other", "scope_completed", "manual_mode", "internal_error", "not_found", "not_owner", "not_active", "validation_failed"];
    for (const reason of reasons) assert.ok(presentTodayError(t, todayApiError({ reason, error: "SECRET RAW" }, 500, "claim")));
    assert.equal(presentTodayError(t, todayApiError({ reason: "user_has_active", activeClaim: { parentHint: "<CUSTOM>", scopeLabel: "other" } }, 409, "claim")), t("errors.active", { task: "<CUSTOM>" }));
    assert.equal(todayApiError({ reason: "user_has_active", activeClaim: { scopeLabel: 42 } }, 409, "claim").key, "errors.activeUnknown");
    for (const reason of ["constructor", "__proto__", "unknown", 42]) for (const status of [400, 403, 404, 409, 500]) assert.ok(!presentTodayError(t, todayApiError({ reason, error: "SECRET RAW" }, status, "complete")).includes("SECRET"));
    assert.equal(todayApiError({}, 401, "load").key, "errors.signIn");
    assert.equal(todayApiError({}, 401, "claim").key, "errors.session");
    assert.equal(todayApiError({}, 403, "load").key, "errors.loadForbidden");
    assert.equal(todayCaughtError(new Error("CUSTOM SECRET"), "complete").key, "errors.complete");
    assert.equal(todayCaughtError(new Error("Failed to fetch"), "claim").key, "errors.network");
    assert.equal((await readTodayError(new Response("invalid", { status: 500 }), "release")).key, "errors.release");
    assert.equal(todayApiError({ error: "Невалидная дата" }, 400, "claim").key, "errors.invalidDate");
  });
}
