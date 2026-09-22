/**
 * Правила личного PIN — одни для генерации, ручного ввода руководителем и
 * запроса сотрудника с QR-страницы. Модуль без зависимостей от сервера:
 * его подключают и клиентские формы (подсказка до отправки).
 */

const SIMPLE_PINS = new Set(["1234", "0123", "4321", "123456", "654321", "012345"]);

/** Ошибка валидации или null, если PIN годится. */
export function validateQrPin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "PIN — от 4 до 6 цифр";
  if (/^(\d)\1+$/.test(pin) || SIMPLE_PINS.has(pin)) return "Слишком простой PIN — выберите другой";
  return null;
}

/**
 * Автогенерация 4-значного PIN: руководитель его не придумывает. Источник
 * случайности передаётся снаружи (node:crypto на сервере, Web Crypto в
 * браузере), результат гарантированно проходит `validateQrPin`.
 */
export function generateQrPin(randomInt: (maxExclusive: number) => number): string {
  for (;;) {
    const pin = String(randomInt(10_000)).padStart(4, "0");
    if (validateQrPin(pin) === null) return pin;
  }
}
