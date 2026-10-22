import assert from "node:assert/strict";
import test from "node:test";
import { kioskError, kioskPasskeyError } from "./kiosk-error-presentation";

test("kiosk failures become semantic keys and safe bounded parameters", () => {
  assert.deepEqual(kioskError("Планшет не привязан"), { key: "device.notLinked" });
  assert.deepEqual(kioskError("Слишком много попыток. Подождите минуту."), { key: "errors.rateLimit" });
  assert.deepEqual(kioskError("Неверный PIN. Осталось попыток: 4."), { key: "errors.pinWrong", attempts: 4 });
  assert.deepEqual(kioskError("PIN заблокирован после ошибок. Попробуйте через 15 мин."), { key: "errors.pinLocked", minutes: 15 });
  assert.deepEqual(kioskError("Подпись не подтверждена: diagnostic"), { key: "errors.passkeyFailed" });
  assert.deepEqual(kioskError("internal database details"), { key: "errors.generic" });
  assert.deepEqual(kioskPasskeyError(new Error("NotAllowedError: cancelled")), { key: "errors.passkeyCancelled" });
  assert.deepEqual(kioskPasskeyError(new Error("socket failure")), { key: "errors.passkeyFailed" });
});
