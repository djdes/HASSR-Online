import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("setup-helper privacy policy reflects no-account standalone operation", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "app", "setup-helper", "privacy", "page.tsx"),
    "utf8",
  );

  // Must explicitly state that no sign-in / registration / personal data collection happens
  assert.match(source, /без регистрации и входа/i);
  // Must not claim that email and password are sent on sign-in
  assert.doesNotMatch(source, /Адрес электронной почты и пароль/);
  assert.doesNotMatch(source, /Ключ входа \(зашифрован ключом Android Keystore/);
});
