import assert from "node:assert/strict";
import { test } from "node:test";
import ru from "./messages/ru.json";
import en from "./messages/en.json";
import uz from "./messages/uz.json";
import { validateCatalog } from "./catalog-validation";

test("all implemented catalogs have complete keys and matching ICU arguments", () => {
  for (const messages of [ru, en, uz]) assert.deepEqual(validateCatalog(ru, messages), []);
});

test("catalog validation rejects missing messages, broken ICU and lost arguments", () => {
  assert.deepEqual(validateCatalog({ greeting: "Hello {name}" }, {}), ["Missing key: greeting"]);
  assert.deepEqual(validateCatalog({ greeting: "Hello {name}" }, { greeting: "Hello" }), ["Argument mismatch: greeting"]);
  assert.match(validateCatalog({ count: "{count}" }, { count: "{count" })[0], /Invalid ICU/);
  assert.throws(() => validateCatalog({ save: "Save" }, { save: " " }), /Empty message/);
  assert.throws(() => validateCatalog({ save: "Save" }, { save: "??????" }), /Corrupted message encoding/);
  assert.throws(() => validateCatalog({ save: "Save" }, { save: "\uFFFD" }), /Corrupted message encoding/);
});

test("different plural categories are valid but nested parameter loss is not", () => {
  const reference = { text: "{count, plural, one {{name}: # запись} few {{name}: # записи} other {{name}: # записей}}" };
  assert.deepEqual(validateCatalog(reference, { text: "{count, plural, one {{name}: # entry} other {{name}: # entries}}" }), []);
  assert.deepEqual(validateCatalog(reference, { text: "{count, plural, one {# entry} other {# entries}}" }), ["Argument mismatch: text"]);
});
