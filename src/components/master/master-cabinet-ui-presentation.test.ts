import assert from "node:assert/strict";
import test from "node:test";
import {
  MASTER_CABINET_UI_ERRORS,
  masterCabinetCreateErrorKey,
  masterCabinetListErrorKey,
  masterCabinetOpenErrorKey,
} from "./master-cabinet-ui-presentation";

test("master cabinet list errors expose only the known access distinction", () => {
  for (const status of [401, 403]) {
    assert.equal(masterCabinetListErrorKey(status), MASTER_CABINET_UI_ERRORS.loadAccess);
  }

  for (const status of [0, 400, 404, 429, 500, 503, 999]) {
    assert.equal(masterCabinetListErrorKey(status), MASTER_CABINET_UI_ERRORS.loadFailed);
  }
});

test("master cabinet create errors map known statuses and safely collapse unknown ones", () => {
  const expected = new Map([
    [400, MASTER_CABINET_UI_ERRORS.createInvalid],
    [401, MASTER_CABINET_UI_ERRORS.createAccess],
    [403, MASTER_CABINET_UI_ERRORS.createAccess],
    [409, MASTER_CABINET_UI_ERRORS.createConflict],
    [429, MASTER_CABINET_UI_ERRORS.createRateLimited],
  ]);

  for (const [status, key] of expected) {
    assert.equal(masterCabinetCreateErrorKey(status), key);
  }

  for (const status of [0, 404, 418, 422, 500, 503, 999]) {
    assert.equal(masterCabinetCreateErrorKey(status), MASTER_CABINET_UI_ERRORS.createFailed);
  }
});

test("master cabinet switching errors never expose an untyped provider message", () => {
  assert.equal(masterCabinetOpenErrorKey(), MASTER_CABINET_UI_ERRORS.openFailed);
});
