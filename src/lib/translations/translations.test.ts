import assert from "node:assert/strict";
import { test } from "node:test";
import ru from "@/i18n/messages/ru.json";
import { flattenMessages } from "@/i18n/catalog-validation";
import { loadBaseMessages, loadMessages } from "@/i18n/messages";
import { applyOverrides, isStaleOverride, looksUntranslated, placeholderNames, readCatalogString, selectSafeOverrides, validateOverride } from "./catalog";
import { buildCategories, CURATED_CATEGORIES } from "./categories";
import { AUTO_TRANSLATE_BATCH, buildAutoTranslateJob, parseAutoTranslateReply } from "./auto-translate";

const catalogs = {
  ru: { "a.title": "Журнал {name}", "a.plain": "Сохранить", "a.count": "{count, plural, one {# строка} few {# строки} many {# строк} other {# строки}}" },
  en: { "a.title": "Log {name}", "a.plain": "Save", "a.count": "{count, plural, one {# string} other {# strings}}" },
};

test("applyOverrides returns the same object without applicable overrides", () => {
  const base = { a: { b: "x" } };
  assert.equal(applyOverrides(base, []), base);
  assert.equal(applyOverrides(base, [["a.missing", "y"], ["a", "y"], ["a.b.c", "y"]]), base);
});

test("applyOverrides patches a copy and leaves the base untouched", () => {
  const base = { a: { b: "x", c: "z" }, d: "w" };
  const result = applyOverrides(base, [["a.b", "y"], ["gone.key", "q"]]);
  assert.notEqual(result, base);
  assert.deepEqual(result, { a: { b: "y", c: "z" }, d: "w" });
  assert.equal(base.a.b, "x");
  assert.equal(readCatalogString(result, "a.b"), "y");
});

test("validateOverride accepts matching arguments and resets empty or original values", () => {
  assert.deepEqual(validateOverride({ locale: "en", key: "a.title", value: "Journal {name}" }, catalogs), { ok: true, action: "set", value: "Journal {name}" });
  assert.deepEqual(validateOverride({ locale: "en", key: "a.title", value: "  " }, catalogs), { ok: true, action: "reset" });
  assert.deepEqual(validateOverride({ locale: "en", key: "a.title", value: null }, catalogs), { ok: true, action: "reset" });
  assert.deepEqual(validateOverride({ locale: "en", key: "a.title", value: "Log {name}" }, catalogs), { ok: true, action: "reset" });
  // Plural branches differ by language, the argument contract does not.
  assert.equal(validateOverride({ locale: "ru", key: "a.count", value: "{count, plural, one {# запись} few {# записи} many {# записей} other {# записи}}" }, catalogs).ok, true);
});

test("validateOverride rejects unknown keys and locales, broken ICU and lost placeholders", () => {
  assert.deepEqual(validateOverride({ locale: "en", key: "nope", value: "x" }, catalogs), { ok: false, error: "unknown_key" });
  assert.deepEqual(validateOverride({ locale: "de", key: "a.title", value: "x" }, catalogs), { ok: false, error: "unknown_locale" });
  assert.deepEqual(validateOverride({ locale: "en", key: "a.title", value: "Journal" }, catalogs), { ok: false, error: "argument_mismatch", expected: ["name"] });
  assert.deepEqual(validateOverride({ locale: "en", key: "a.title", value: "Journal {nam}" }, catalogs), { ok: false, error: "argument_mismatch", expected: ["name"] });
  assert.deepEqual(validateOverride({ locale: "en", key: "a.title", value: "Journal {name" }, catalogs), { ok: false, error: "invalid_icu" });
  assert.deepEqual(validateOverride({ locale: "en", key: "a.plain", value: "Save �" }, catalogs), { ok: false, error: "corrupted" });
  assert.deepEqual(validateOverride({ locale: "en", key: "a.plain", value: "x".repeat(10_001) }, catalogs), { ok: false, error: "too_long" });
});

test("untranslated heuristics and placeholder hints", () => {
  assert.equal(looksUntranslated("en", "Сохранить", "Сохранить"), true);
  assert.equal(looksUntranslated("uz", "Saqlash", "Сохранить"), false);
  assert.equal(looksUntranslated("en", "Save СанПиН", "Сохранить"), true);
  assert.equal(looksUntranslated("ru", "Сохранить", "Сохранить"), false);
  assert.deepEqual(placeholderNames(catalogs.ru["a.count"]), ["count"]);
  assert.deepEqual(placeholderNames("{broken"), []);
});

test("categories cover every catalog key exactly once and start with the hygiene journal", () => {
  const keys = Object.keys(flattenMessages(ru));
  const categories = buildCategories(keys);
  assert.equal(categories[0].id, "journal-hygiene");
  const seen = categories.flatMap((category) => category.keys);
  assert.equal(seen.length, keys.length);
  assert.equal(new Set(seen).size, keys.length);
  const hygiene = categories[0].keys;
  assert.ok(hygiene.includes("hygiene.columns.employee"));
  assert.ok(hygiene.includes("journalFields.hygiene.employeeName.label"));
  assert.ok(hygiene.includes("journalDocGuides.hygiene.intro"));
  assert.ok(!hygiene.some((key) => key.startsWith("journalFields.health_check.")));
  // Every curated prefix still points at real strings after catalog refactors.
  for (const category of CURATED_CATEGORIES) {
    // Прочие журналы не обязаны иметь строки в каждом пространстве — их проверяет тест ниже.
    if (category.id.startsWith("journal-") && category.id !== "journal-hygiene") continue;
    for (const prefix of category.prefixes) {
      assert.ok(keys.some((key) => key === prefix || key.startsWith(`${prefix}.`)), `${category.id}: ${prefix}`);
    }
  }
  const other = categories.find((category) => category.id === "ns:journalFields");
  assert.ok(other && !other.keys.some((key) => key.startsWith("journalFields.hygiene.")));
});

test("auto-translate job keeps the dispatcher type and accepts only safe replies", () => {
  const source = { "a.title": "Журнал {name}", "a.plain": "Сохранить", "a.extra": "Ещё" };
  const job = buildAutoTranslateJob("uz", source);
  assert.match(job, /^type: wesetup_translate\n/);
  assert.match(job, /"a\.title": "Журнал \{name\}"/);
  const reply = "```json\n" + JSON.stringify({ "a.title": "Jurnal {name}", "a.plain": "Saqlash", "a.extra": "Yana {oops}", "injected": "x" }) + "\n```";
  assert.deepEqual(parseAutoTranslateReply(reply, source), {
    translations: { "a.title": "Jurnal {name}", "a.plain": "Saqlash" },
    rejected: ["a.extra"],
  });
  assert.deepEqual(parseAutoTranslateReply("no json here", source).rejected, Object.keys(source));
  assert.ok(AUTO_TRANSLATE_BATCH <= 50);
});

test("loadMessages reads the catalog files under node --test", async () => {
  assert.equal(await loadMessages("en"), await loadBaseMessages("en"));
});

test("every journal of the catalog has its own category with a title from the catalog", () => {
  const flat = flattenMessages(ru);
  const categories = buildCategories(Object.keys(flat));
  const journalCategories = categories.filter((category) => category.group === "journals");
  assert.ok(journalCategories.length > 20);
  for (const category of journalCategories) {
    assert.ok(category.keys.length > 0, category.id);
    assert.ok(category.titleKey && flat[category.titleKey], `${category.id} title`);
  }
  assert.ok(journalCategories.find((category) => category.id === "journal-climate_control")?.keys.some((key) => key.startsWith("climate.")));
});

test("big client namespaces are split per component in other sections", () => {
  const categories = buildCategories(["journalUi.medBook.save", "journalUi.photoCapture.title", "settingsUi.staff.add", "unknownPlain.key"]);
  const ids = categories.filter((category) => category.group === "other").map((category) => category.id);
  assert.deepEqual(ids, ["ns:journalUi.medBook", "ns:journalUi.photoCapture", "ns:settingsUi.staff", "ns:unknownPlain"]);
});

test("a hand-made translation is marked stale when the Russian source changes, and never loses its value", () => {
  assert.equal(isStaleOverride("Сохранить", "Сохранить"), false);
  assert.equal(isStaleOverride("Сохранить", "Записать"), true);
  // Правки, сохранённые до появления снимка исходника, не помечаем.
  assert.equal(isStaleOverride(null, "Записать"), false);
  assert.equal(isStaleOverride(undefined, "Записать"), false);
});

test("overrides whose arguments no longer match the Russian source are not applied", () => {
  const russian: Record<string, string> = { "a.title": "Журнал {name}", "a.plain": "Сохранить" };
  const safe = selectSafeOverrides(
    [["a.title", "Log {name}"], ["a.title", "Log"], ["a.plain", "Save"], ["gone", "x"], ["a.plain", "Save {oops"]],
    (key) => russian[key],
  );
  assert.deepEqual(safe, [["a.title", "Log {name}"], ["a.plain", "Save"]]);
});
