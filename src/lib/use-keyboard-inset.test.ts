import assert from "node:assert/strict";
import test from "node:test";

import { keyboardSheetMaxHeight } from "./use-keyboard-inset";

test("окно над клавиатурой не выше видимой части экрана и не заезжает под часы", () => {
  assert.equal(keyboardSheetMaxHeight(420.4), "calc(420px - env(safe-area-inset-top, 0px) - 12px)");
  assert.equal(keyboardSheetMaxHeight(0), null);
});
