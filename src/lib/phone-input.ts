import type { ChangeEvent, FocusEvent } from "react";

/**
 * Поле телефона с уже подставленным «+7».
 *
 * Пустое поле при фокусе получает «+7 », дальше человек набирает только
 * номер, а мы раскладываем цифры в «+7 999 123-45-67» по мере ввода.
 * Вставка «8 985 123 45 67» или «+7 (985) 123-45-67» тоже приводится к
 * этому виду. Если поле покинули, не набрав ничего, кроме префикса, оно
 * снова пустое — необязательный телефон не превращается в «+7 ».
 *
 * Иностранный номер набрать можно: стереть префикс и начать с «+» и
 * другого кода — такой ввод не трогаем. Сервер принимает оба варианта
 * (`normalizePhone`).
 *
 * Чистые функции без хуков: `phoneInputProps` можно расстелить прямо в
 * JSX любого `<input>` / `<Input>`.
 */
export const RU_PHONE_PREFIX = "+7 ";
export const RU_PHONE_PLACEHOLDER = "+7 999 123-45-67";
const NATIONAL_DIGITS = 10;

const digitsOf = (value: string) => value.replace(/\D/g, "");

export function formatRuPhoneInput(raw: string, previous = ""): string {
  if (raw === "") return "";
  // Поле при фокусе уже содержит «+7 ». Человек по привычке набирает свой
  // «+7…» поверх — выходит «+7 +7 999…». Берём то, что после последнего
  // плюса: иначе вторая семёрка считалась первой цифрой номера, последняя
  // цифра терялась, и сохранялся чужой номер.
  const lastPlus = raw.lastIndexOf("+");
  const trimmed = (lastPlus > 0 ? raw.slice(lastPlus) : raw).trim();
  const allDigits = digitsOf(trimmed);

  // Явно другой код страны — оставляем как есть.
  if (trimmed.startsWith("+") && allDigits.length > 0 && !allDigits.startsWith("7")) {
    return raw.slice(0, 20);
  }

  // Backspace на «+7 » — даём стереть префикс целиком.
  if (previous === RU_PHONE_PREFIX && raw.length < previous.length) return "";

  let national: string;
  if (trimmed.startsWith("+")) {
    national = allDigits.slice(1);
  } else if (allDigits.startsWith("8") || allDigits.startsWith("7")) {
    // Местный «8 985…» или «7985…» без плюса — это код страны, не номер.
    national = allDigits.slice(1);
  } else {
    national = allDigits;
  }
  // То же с привычной «8»: после подставленного «+7 » набирают «8 999 …».
  // Одиннадцать цифр, начинающихся с 8 или 7, — это номер с кодом страны,
  // а не десятизначный номер с лишней цифрой в конце.
  if (national.length > NATIONAL_DIGITS && /^[78]/.test(national)) {
    national = national.slice(1);
  }
  national = national.slice(0, NATIONAL_DIGITS);

  // Backspace на пробеле или дефисе: цифры не изменились, а строка стала
  // короче — значит, человек хотел стереть последнюю цифру.
  if (previous && raw.length < previous.length && digitsOf(previous) === allDigits) {
    national = national.slice(0, -1);
  }

  if (national.length === 0) return RU_PHONE_PREFIX;
  let out = `+7 ${national.slice(0, 3)}`;
  if (national.length > 3) out += ` ${national.slice(3, 6)}`;
  if (national.length > 6) out += `-${national.slice(6, 8)}`;
  if (national.length > 8) out += `-${national.slice(8, 10)}`;
  return out;
}

/** Только префикс без цифр номера — поле по сути пустое. */
export function isRuPhonePrefixOnly(value: string): boolean {
  return value.trim() !== "" && digitsOf(value).replace(/^7/, "") === "";
}

export function phoneInputProps(
  value: string,
  onChange: (next: string) => void,
  extra: { onBlur?: () => void } = {},
) {
  return {
    value,
    inputMode: "tel" as const,
    autoComplete: "tel" as const,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      onChange(formatRuPhoneInput(event.target.value, value));
    },
    onFocus: (event: FocusEvent<HTMLInputElement>) => {
      if (event.target.value === "") onChange(RU_PHONE_PREFIX);
    },
    onBlur: () => {
      if (isRuPhonePrefixOnly(value)) onChange("");
      extra.onBlur?.();
    },
  };
}
