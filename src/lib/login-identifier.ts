/**
 * Что человек ввёл в поле входа на сайте — почту или номер телефона.
 *
 * ПОЧЕМУ: на `/login` вход только по почте, а сотрудник, зарегистрированный
 * по QR-коду, знает лишь свой номер (почта у него служебная). Он вбивал
 * телефон, и браузер показывал английское «Please include an '@' in the
 * email address» — подсказка не по делу и не по-русски. Теперь мы сами
 * распознаём номер и отправляем человека на `/mini/login`, где вход по
 * телефону работает.
 */

/** Похоже на телефон: начинается с «+» или цифры и содержит ≥10 цифр. */
export function looksLikePhoneInput(raw: string): boolean {
  const value = (raw ?? "").trim();
  if (value === "") return false;
  if (value.includes("@")) return false;
  if (!/^[+\d]/.test(value)) return false;
  // Кроме цифр допускаем только разделители номера.
  if (!/^\+?[\d\s\-()]+$/.test(value)) return false;
  return value.replace(/\D+/g, "").length >= 10;
}

/** Нормализованный номер для подстановки в `/mini/login?phone=`. */
export function phoneQueryValue(raw: string): string {
  const digits = (raw ?? "").replace(/\D+/g, "");
  if (digits === "") return "";
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}
