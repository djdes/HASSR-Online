import assert from "node:assert/strict";
import test from "node:test";
import { taskVisibilitySaveError } from "./task-visibility-presentation";

test("finite descriptors require their expected status, including both400 families", () => {
  for (const [code, status, key] of [
    ["TASK_VISIBILITY_FORBIDDEN", 403, "errors.forbidden"],
    ["TASK_VISIBILITY_INVALID_BODY", 400, "errors.invalidBody"],
    ["TASK_VISIBILITY_FOREIGN_POSITIONS", 400, "errors.foreignPositions"],
  ] as const) {
    assert.equal(taskVisibilitySaveError({ errorCode: code }, status), key);
    assert.equal(taskVisibilitySaveError({ errorCode: code }, 503), "errors.saveFailed");
  }
});

test("unknown/prototype/getter/nonobject descriptors cannot select a managed reason", () => {
  for (const code of ["constructor", "__proto__", "toString", "UNKNOWN", "", null, 0, {}]) {
    assert.equal(taskVisibilitySaveError({ errorCode: code }, 400), "errors.saveFailed");
  }
  assert.equal(taskVisibilitySaveError(Object.create({ errorCode: "TASK_VISIBILITY_INVALID_BODY" }), 400), "errors.saveFailed");
  assert.equal(taskVisibilitySaveError({ get errorCode() { throw new Error("getter must not run"); } }, 400), "errors.saveFailed");
  for (const data of [null, undefined, "RAW", [], 4]) assert.equal(taskVisibilitySaveError(data, 400), "errors.saveFailed");
  let reads = 0;
  const inherited = [
    { errorCode: "UNKNOWN" },
    { errorCode: "TASK_VISIBILITY_FORBIDDEN" },
    { get errorCode() { reads++; throw new Error("inherited getter must not run"); } },
  ];
  for (const prototype of inherited) {
    assert.equal(taskVisibilitySaveError(Object.create(prototype), 403), "errors.saveFailed");
    assert.equal(taskVisibilitySaveError(Object.create(prototype), 401), "errors.unauthorized");
  }
  assert.equal(reads, 0);
});

test("legacy ambiguous400 is generic; unique403 and shared401 remain local presentation", () => {
  assert.equal(taskVisibilitySaveError({ error: "Body должен содержать positionIds: string[]" }, 400), "errors.saveFailed");
  assert.equal(taskVisibilitySaveError({ error: "Некоторые должности не принадлежат организации" }, 400), "errors.saveFailed");
  assert.equal(taskVisibilitySaveError({}, 403), "errors.forbidden");
  assert.equal(taskVisibilitySaveError(null, 401), "errors.unauthorized");
});
