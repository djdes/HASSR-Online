import assert from "node:assert/strict";
import test from "node:test";
import { composeCount, composeError, composeKindKey, composePreviewRecipient, composeStatusKey } from "./compose-presentation";

test("only finite managed enum keys are translated; inherited and unknown identifiers remain raw", () => {
  assert.equal(composeKindKey("message"), "message.kind.message");
  assert.equal(composeKindKey("kp"), "message.kind.kp");
  for (const value of ["constructor", "__proto__", "toString", "unknown-plugin", "MESSAGE", ""]) {
    assert.equal(composeKindKey(value), null);
    assert.equal(composeStatusKey(value), null);
  }
  for (const value of ["queued", "sending", "sent", "failed", "skipped"]) assert.equal(composeStatusKey(value), `status.${value}`);
});

test("sample metadata validates own version/kind/string data and never infers identity from a label", () => {
  const sample = { version: 1, kind: "sample", name: "Иван Петров", companyName: "Кафе «Ромашка»" };
  assert.deepEqual(composePreviewRecipient(sample), sample);
  assert.deepEqual(composePreviewRecipient({ version: 1, kind: "actual" }), { version: 1, kind: "actual" });
  for (const value of [null, undefined, "Пример: Иван Петров, Кафе «Ромашка»", [], {}, { version: 2, kind: "sample" }, { version: "1", kind: "actual" }, { version: 1, kind: "constructor" }, { version: 1, kind: "sample", name: "RAW", companyName: null }, Object.create(sample), Object.assign(Object.create({ kind: "actual" }), { version: 1 }), Object.assign(Object.create({ name: "RAW" }), { version: 1, kind: "sample", companyName: "RAW" })]) assert.equal(composePreviewRecipient(value), null);
  assert.equal(JSON.stringify(sample), '{"version":1,"kind":"sample","name":"Иван Петров","companyName":"Кафе «Ромашка»"}');
});

test("plural selectors distinguish 0/1/2/5/21/12500 while display remains ungrouped", () => {
  const cases = [[0, "many", "other"], [1, "one", "one"], [2, "few", "other"], [5, "many", "other"], [21, "one", "other"], [12500, "many", "other"]] as const;
  for (const [count, ru, en] of cases) {
    assert.deepEqual(composeCount(count, "ru"), { displayCount: String(count), category: ru });
    assert.deepEqual(composeCount(count, "en"), { displayCount: String(count), category: en });
    assert.equal(composeCount(count, "uz").displayCount, String(count));
  }
  assert.deepEqual(composeCount("21", "ru"), { displayCount: "21", category: "one" });
  assert.deepEqual(composeCount(" 21 ", "ru"), { displayCount: " 21 ", category: "one" });
  assert.deepEqual(composeCount("001", "en"), { displayCount: "001", category: "one" });
});

test("malformed display values use neutral grammar without invalid ICU numeric arguments or producer mutation", () => {
  for (const value of [undefined, NaN, Infinity, -Infinity, null, {}, "", "not-a-count"]) {
    const expected = String(value);
    const result = composeCount(value, "ru");
    assert.equal(result.displayCount, expected);
    assert.equal(result.category, "other");
    assert.deepEqual(Object.keys(result).sort(), ["category", "displayCount"]);
  }
  const original = { users: "2", contacts: "3" };
  const concatenation = original.users + original.contacts;
  assert.equal(concatenation, "23");
  assert.equal(composeCount(concatenation, "ru").displayCount, "23");
  assert.deepEqual(original, { users: "2", contacts: "3" });
});

test("finite failures preserve only exact existing Error.message without inspecting diagnostics or non-errors", () => {
  const error = new Error("  RAW русский <tag>\n{имя}  ");
  Object.defineProperty(error, "stack", { get: () => { throw new Error("Do not inspect stack"); } });
  Object.defineProperty(error, "cause", { get: () => { throw new Error("Do not inspect cause"); } });
  for (const key of ["reachFailed", "previewFailed", "testFailed", "launchFailed"] as const) assert.deepEqual(composeError(key, error), { key, detail: "  RAW русский <tag>\n{имя}  " });
  assert.deepEqual(composeError("testFailed", new Error("")), { key: "testFailed", detail: "" });
  const nonError = { get message() { throw new Error("Do not inspect arbitrary objects"); } };
  assert.deepEqual(composeError("testFailed", nonError), { key: "testFailed" });
  assert.deepEqual(composeError("launchFailed", "RAW diagnostic"), { key: "launchFailed" });
});
