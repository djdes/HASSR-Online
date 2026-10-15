import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONTROL_PERIODICITY, LEGACY_DEFAULT_CONTROL_PERIODICITY, readControlPeriodicity } from "@/lib/control-periodicity";
import { standardPeriodicityKey } from "./control-periodicity-presentation";
import { loadMessages } from "./messages";

test("every default monitoring rule has three translations and legacy values resolve without mutating config", async () => {
  const codes = Object.keys(DEFAULT_CONTROL_PERIODICITY).sort();
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = (await loadMessages(locale)).journalWidgets.periodicity;
    assert.deepEqual(Object.keys(messages).filter(key => key !== "fallback").sort(), codes);
    for (const code of codes) {
      for (const text of [DEFAULT_CONTROL_PERIODICITY[code], ...(LEGACY_DEFAULT_CONTROL_PERIODICITY[code] ?? [])]) {
        const config = { controlPeriodicity: text };
        const before = structuredClone(config);
        const key = standardPeriodicityKey(readControlPeriodicity(config, code), code);
        assert.equal(key, code);
        assert.ok(key && messages[key]);
        assert.deepEqual(config, before);
        if (locale === "ru") assert.equal(messages[key!], DEFAULT_CONTROL_PERIODICITY[code]);
      }
      assert.equal(standardPeriodicityKey("", code), null);
      assert.equal(standardPeriodicityKey("Каждые 37 минут — собственное правило O‘tkir", code), null);
    }
  }
});

test("monitoring rule translation is bound to journal code, not a phrase-wide replacement", () => {
  assert.equal(standardPeriodicityKey(DEFAULT_CONTROL_PERIODICITY.hygiene, "climate_control"), null);
  assert.equal(standardPeriodicityKey(DEFAULT_CONTROL_PERIODICITY.hygiene), null);
  assert.equal(standardPeriodicityKey("__proto__", "__proto__"), null);
  assert.equal(standardPeriodicityKey("Авторское правило", "new_custom_journal"), null);
});
