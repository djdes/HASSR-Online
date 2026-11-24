import { test } from "node:test";
import assert from "node:assert/strict";
import { routeOverlayBase } from "./route-overlay";

test("адрес пункта структуры ППК — окно поверх обзора", () => {
  assert.equal(routeOverlayBase("/production-control/item/1-1"), "/production-control");
  assert.equal(routeOverlayBase("/production-control/item/app-6"), "/production-control");
  assert.equal(routeOverlayBase("/production-control"), null);
  assert.equal(routeOverlayBase("/production-control/haccp/team"), null);
  assert.equal(routeOverlayBase("/production-control/items"), null);
  assert.equal(routeOverlayBase(null), null);
});
