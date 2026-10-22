export const KIOSK_STATIC_ERROR_KEYS = [
  "device.notLinked",
  "device.loadFailed",
  "device.network",
  "errors.generic",
  "errors.network",
  "errors.rateLimit",
  "errors.employeeNotFound",
  "errors.pinIncorrect",
  "errors.pinLockedNow",
  "errors.pinNotSet",
  "errors.passkeyMissing",
  "errors.invalidData",
  "errors.challengeExpired",
  "errors.keyNotFound",
  "errors.keyOtherEmployee",
  "errors.passkeyFailed",
  "errors.passkeyCancelled",
] as const;

export type KioskStaticErrorKey = (typeof KIOSK_STATIC_ERROR_KEYS)[number];
export type KioskError =
  | { key: "errors.pinWrong"; attempts: number }
  | { key: "errors.pinLocked"; minutes: number }
  | { key: KioskStaticErrorKey };

const KNOWN_ERRORS: Readonly<Record<string, KioskStaticErrorKey>> = {
  "Планшет не привязан": "device.notLinked",
  "Не удалось загрузить список": "device.loadFailed",
  "Нет связи": "device.network",
  "Слишком много попыток. Подождите минуту.": "errors.rateLimit",
  "Сотрудник не найден": "errors.employeeNotFound",
  "Неверный ПИН": "errors.pinIncorrect",
  "Неверный PIN": "errors.pinIncorrect",
  "Неверный PIN 5 раз — вход заблокирован на 15 минут.": "errors.pinLockedNow",
  "У сотрудника не задан PIN. Попросите руководителя задать его в карточке сотрудника.": "errors.pinNotSet",
  "У сотрудника нет ключа Face ID — добавьте его в профиле на своём телефоне": "errors.passkeyMissing",
  "Некорректные данные": "errors.invalidData",
  "Запрос устарел — попробуйте ещё раз": "errors.challengeExpired",
  "Ключ не найден": "errors.keyNotFound",
  "Ключ принадлежит другому сотруднику": "errors.keyOtherEmployee",
  "Подпись не подтверждена": "errors.passkeyFailed",
  "Отменено": "errors.passkeyCancelled",
};

/** Exact known legacy responses become stable semantic keys; unknown text is hidden. */
export function kioskError(value: unknown): KioskError {
  if (typeof value !== "string") return { key: "errors.generic" };

  const wrongPin = /^Неверный PIN\. Осталось попыток: (\d+)\.$/u.exec(value);
  if (wrongPin) return { key: "errors.pinWrong", attempts: Number(wrongPin[1]) };

  const pinLocked = /^PIN заблокирован после ошибок\. Попробуйте через (\d+) мин\.$/u.exec(value);
  if (pinLocked) return { key: "errors.pinLocked", minutes: Number(pinLocked[1]) };

  if (value.startsWith("Подпись не подтверждена:")) return { key: "errors.passkeyFailed" };
  if (Object.hasOwn(KNOWN_ERRORS, value)) return { key: KNOWN_ERRORS[value] };
  return { key: "errors.generic" };
}

export function kioskPasskeyError(value: unknown): KioskError {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (/NotAllowed|cancel|abort/i.test(message)) return { key: "errors.passkeyCancelled" };
  return { key: "errors.passkeyFailed" };
}
