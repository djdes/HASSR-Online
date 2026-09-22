import assert from "node:assert/strict";
import test from "node:test";

import { generateQrPin, validateQrPin } from "@/lib/qr-pin-rules";

/**
 * Одни правила PIN для генерации, ручного ввода руководителем и запроса
 * сотрудника с QR-страницы. Запрета на «простые» комбинации нет: людям
 * на кухне важнее запомнить код, перебор ограничен лимитом попыток.
 */
test("PIN: от 4 до 6 цифр", () => {
  assert.equal(validateQrPin("4821"), null);
  assert.equal(validateQrPin("482193"), null);
  assert.match(validateQrPin("482") ?? "", /4 до 6/);
  assert.match(validateQrPin("48a1") ?? "", /4 до 6/);
  assert.match(validateQrPin("") ?? "", /4 до 6/);
});

test("PIN: простые комбинации разрешены — запрета нет", () => {
  for (const pin of ["0000", "1111", "1234", "0123", "123456", "4321", "654321"]) {
    assert.equal(validateQrPin(pin), null, pin);
  }
});

test("генератор выдаёт только коды, которые проходят проверку", () => {
  const sequence = [123, 4821];
  let index = 0;
  const pin = generateQrPin(() => sequence[index++]);
  assert.equal(pin, "0123");
  assert.equal(validateQrPin(pin), null);
});
