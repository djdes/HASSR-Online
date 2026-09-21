import assert from "node:assert/strict";
import test from "node:test";

import {
  getUserDisplayName,
  looksLikeEmail,
  NO_NAME_LABEL,
} from "@/lib/user-display-name";

test("обычное имя показывается как есть", () => {
  assert.equal(getUserDisplayName({ name: "Иванова И.И." }), "Иванова И.И.");
});

test("почта вместо имени не показывается", () => {
  // Было «Управляющий - owner-a@e2e.local» в списках и на бланке.
  assert.equal(getUserDisplayName({ name: "owner-a@e2e.local" }), NO_NAME_LABEL);
  assert.equal(
    getUserDisplayName({ name: "owner-a@e2e.local" }, "Управляющий"),
    "Управляющий"
  );
  assert.equal(
    getUserDisplayName({ name: "Owner@Site.ru", email: "owner@site.ru" }, "Управляющий"),
    "Управляющий"
  );
});

test("пустое имя — должность или «Без имени»", () => {
  assert.equal(getUserDisplayName({ name: "" }, "Повар"), "Повар");
  assert.equal(getUserDisplayName({ name: "  " }), NO_NAME_LABEL);
});

test("распознавание почты", () => {
  assert.equal(looksLikeEmail("a@b.ru"), true);
  assert.equal(looksLikeEmail("Иванова И.И."), false);
});
