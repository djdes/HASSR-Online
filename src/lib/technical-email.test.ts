import assert from "node:assert/strict";
import test from "node:test";

import { isTechnicalEmail } from "@/lib/technical-email";

test("служебные адреса распознаются", () => {
  assert.equal(isTechnicalEmail("79991234567@cmfx1234.staff.local"), true);
  assert.equal(isTechnicalEmail("staff-a1b2c3@cmfx1234.local.haccp"), true);
});

test("настоящая почта служебной не считается", () => {
  assert.equal(isTechnicalEmail("ivanova@restoran.ru"), false);
  assert.equal(isTechnicalEmail("chef@gmail.com"), false);
});

test("пустое значение — не адрес", () => {
  assert.equal(isTechnicalEmail(""), false);
  assert.equal(isTechnicalEmail(null), false);
  assert.equal(isTechnicalEmail("без-собаки"), false);
});
