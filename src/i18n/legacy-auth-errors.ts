import type { Messages } from "./messages";

// Known legacy API response strings: compatibility identifiers, not UI copy.
const ERROR_KEYS = {
  "Введите email и пароль": "loginCredentialsRequired",
  "Слишком много попыток входа. Подождите 5 минут.": "loginRateLimited",
  "Неверный email или пароль": "invalidCredentials",
  "Внутренняя ошибка сервера": "loginInternal",
  "Слишком много попыток. Подождите 5 минут.": "loginCodeRateLimited",
  "Введите код": "codeRequired",
  "Слишком часто. Попробуйте через несколько минут": "tooFrequent",
  "Введите почту": "emailRequired",
  "Укажите корректный адрес электронной почты": "registrationEmailInvalid",
  "Отметьте согласие с офертой, соглашением и обработкой персональных данных": "registrationConsentRequired",
  "Такого почтового домена не существует — проверьте адрес. Письмо с паролем на него не дойдёт": "registrationDomainInvalid",
  "Не получилось создать аккаунт. Попробуйте ещё раз": "registrationFailed",
  "Telegram не привязан": "telegramNotLinked",
  "Не удалось отправить код в Telegram — попробуйте позже": "telegramDeliveryFailed",
  "Код устарел — войдите заново": "challengeExpired",
  "Аккаунт недоступен": "accountUnavailable",
  "Код устарел — войдите заново, пришлём новый": "challengeExpiredRequestNew",
  "Этот код уже использован — войдите заново": "challengeAlreadyUsed",
  "Слишком много попыток — войдите заново, пришлём новый код": "challengeAttemptsExceeded",
  "Неверный код": "challengeCodeMismatch"
} as const satisfies Record<string, keyof Messages["auth"]["apiErrors"]>;

export function legacyAuthErrorKey(value: unknown): keyof Messages["auth"]["apiErrors"] | null {
  return typeof value === "string" && Object.hasOwn(ERROR_KEYS, value.trim())
    ? ERROR_KEYS[value.trim() as keyof typeof ERROR_KEYS] : null;
}
