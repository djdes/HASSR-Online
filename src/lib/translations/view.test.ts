import assert from "node:assert/strict";
import { test } from "node:test";
import { historyItemsFromAudit, isAutoCandidate, matchesFilter, parseTranslationView, translationViewSearch, type TranslationView } from "./view";

const clean = { overridden: [], untranslated: [], stale: [] } as const;

test("filters: modified, untranslated and stale (edited, then the Russian source changed)", () => {
  const stale = { overridden: ["en"], untranslated: [], stale: ["en"] } as const;
  const edited = { overridden: ["uz"], untranslated: [], stale: [] } as const;
  const missing = { overridden: [], untranslated: ["uz"], stale: [] } as const;
  assert.deepEqual([clean, stale, edited, missing].map((entry) => matchesFilter(entry, "all")), [true, true, true, true]);
  assert.deepEqual([clean, stale, edited, missing].map((entry) => matchesFilter(entry, "modified")), [false, true, true, false]);
  assert.deepEqual([clean, stale, edited, missing].map((entry) => matchesFilter(entry, "untranslated")), [false, false, false, true]);
  assert.deepEqual([clean, stale, edited, missing].map((entry) => matchesFilter(entry, "stale")), [false, true, false, false]);
});

test("auto-translate candidates: untranslated in that language and never edited by hand", () => {
  assert.equal(isAutoCandidate({ overridden: [], untranslated: ["en", "uz"], stale: [] }, "en"), true);
  assert.equal(isAutoCandidate({ overridden: ["en"], untranslated: ["en"], stale: [] }, "en"), false);
  assert.equal(isAutoCandidate({ overridden: [], untranslated: ["uz"], stale: [] }, "en"), false);
});

test("view round-trips through the address and skips defaults", () => {
  const sections = { known: new Set(["journal-hygiene", "navigation"]), fallback: "journal-hygiene" };
  const view: TranslationView = { q: "журнал", section: "navigation", filter: "stale", page: 2, key: "navigation.title" };
  const search = translationViewSearch(view, "journal-hygiene");
  assert.equal(search, "?q=%D0%B6%D1%83%D1%80%D0%BD%D0%B0%D0%BB&section=navigation&filter=stale&page=3&key=navigation.title");
  assert.deepEqual(parseTranslationView(new URLSearchParams(search), sections), view);
  assert.equal(translationViewSearch({ q: "", section: "journal-hygiene", filter: "all", page: 0, key: null }, "journal-hygiene"), "");
  assert.deepEqual(parseTranslationView({ section: "all", page: ["2", "5"] }, sections), { q: "", section: "all", filter: "all", page: 1, key: null });
});

test("garbage in the address falls back to defaults", () => {
  const sections = { known: new Set(["navigation"]), fallback: "navigation" };
  assert.deepEqual(parseTranslationView({ section: "nope", filter: "bad", page: "-3", q: `  ${"x".repeat(300)}  `, key: "k".repeat(301) }, sections), {
    q: "x".repeat(200),
    section: "navigation",
    filter: "all",
    page: 0,
    key: null,
  });
  assert.equal(parseTranslationView({ page: "abc" }, sections).page, 0);
});

test("history comes from audit rows and skips broken ones", () => {
  const at = new Date("2026-10-25T10:00:00Z");
  const items = historyItemsFromAudit([
    { id: "1", action: "translation.update", details: { locale: "en", key: "a.b", before: "Save", after: "Store" }, userName: "Алексей", createdAt: at },
    { id: "2", action: "translation.reset", details: { locale: "uz", key: "a.b", before: "X", after: "Saqlash" }, userName: null, createdAt: at },
    { id: "3", action: "translation.update", details: { locale: "de", before: "a", after: "b" }, userName: null, createdAt: at },
    { id: "4", action: "translation.update", details: null, userName: null, createdAt: at },
    { id: "5", action: "translation.update", details: { locale: "ru", before: 1, after: "b" }, userName: null, createdAt: at },
  ]);
  assert.deepEqual(items, [
    { id: "1", locale: "en", action: "update", before: "Save", after: "Store", userName: "Алексей", createdAt: "2026-10-25T10:00:00.000Z" },
    { id: "2", locale: "uz", action: "reset", before: "X", after: "Saqlash", userName: null, createdAt: "2026-10-25T10:00:00.000Z" },
  ]);
});
