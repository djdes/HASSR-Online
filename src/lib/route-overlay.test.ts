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

test("окно поверх той же страницы — без прокрутки наверх; другая страница — с ней", async () => {
  const { isOverlayTransition } = await import("./route-overlay");
  assert.equal(isOverlayTransition("/production-control", "/production-control/item/2-6"), true, "открыли окно");
  assert.equal(isOverlayTransition("/production-control/item/2-6", "/production-control"), true, "закрыли окно");
  assert.equal(isOverlayTransition("/production-control/item/2-6", "/production-control/item/2-7"), true, "из окна в окно");
  assert.equal(isOverlayTransition("/dashboard", "/production-control/item/1-1"), false, "пункт страницей с другого раздела");
  assert.equal(isOverlayTransition("/production-control", "/production-control/revisions"), false);
  assert.equal(isOverlayTransition("/journals", "/settings"), false);
  assert.equal(isOverlayTransition(null, "/production-control/item/1-1"), false);
});
