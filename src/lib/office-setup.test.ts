import { test } from "node:test";
import assert from "node:assert/strict";
import { officeSetupState } from "./office-setup";

test("одна точка без деления — офис можно выделить", () => {
  assert.equal(officeSetupState({ perLocationJournals: false, hasOffice: false, pointCount: 1 }), "create");
});

test("точек нет — сначала добавить торговую точку", () => {
  assert.equal(officeSetupState({ perLocationJournals: false, hasOffice: false, pointCount: 0 }), "noPoints");
  assert.equal(officeSetupState({ perLocationJournals: true, hasOffice: true, pointCount: 0 }), "noPoints");
});

test("офис есть и деление включено — страница офиса", () => {
  assert.equal(officeSetupState({ perLocationJournals: true, hasOffice: true, pointCount: 1 }), "ready");
});

test("офис есть, но деление выключили — кнопка снова включает", () => {
  assert.equal(officeSetupState({ perLocationJournals: false, hasOffice: true, pointCount: 2 }), "create");
});

test("деление включено, офиса нет — кнопка выделить офис", () => {
  assert.equal(officeSetupState({ perLocationJournals: true, hasOffice: false, pointCount: 3 }), "create");
});
