import assert from "node:assert/strict";
import test from "node:test";

import { generateQrPin, validateQrPin } from "@/lib/qr-pin-rules";

/**
 * Одни правила PIN для генерации, ручного ввода руководителем и запроса
 * сотрудника с QR-страницы: раньше генератор отсеивал «0123», а проверка —
 * «123456», и сгенерированный код мог не пройти проверку.
 */
test("PIN: от 4 до 6 цифр", () => {
  assert.equal(validateQrPin("4821"), null);
  assert.equal(validateQrPin("482193"), null);
  assert.match(validateQrPin("482") ?? "", /4 до 6/);
  assert.match(validateQrPin("48a1") ?? "", /4 до 6/);
  assert.match(validateQrPin("") ?? "", /4 до 6/);
});

test("PIN: слишком простые отклоняются", () => {
  for (const pin of ["0000", "1111", "1234", "0123", "123456", "4321", "654321"]) {
    assert.match(validateQrPin(pin) ?? "", /простой/, pin);
  }
});

test("генератор выдаёт только коды, которые проходят проверку", () => {
  const sequence = [0, 1111, 1234, 123, 4321, 4821];
  let index = 0;
  const pin = generateQrPin(() => sequence[index++]);
  assert.equal(pin, "4821");
  assert.equal(validateQrPin(pin), null);
});
