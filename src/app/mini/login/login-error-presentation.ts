export type LoginErrorKey =
  | "phoneRequired"
  | "emailRequired"
  | "invalidPhoneCredentials"
  | "invalidEmailCredentials"
  | "rateLimited"
  | "server"
  | "telegramNotLinked"
  | "telegramDelivery"
  | "codeRequired"
  | "invalidCode"
  | "expiredCode"
  | "usedCode"
  | "tooManyCodeAttempts"
  | "accountUnavailable"
  | "loginFailed"
  | "connectionFailed";

/** Translate exact legacy API strings while keeping unknown diagnostics private. */
export function miniLoginErrorKey(message: unknown, codeStep = false): LoginErrorKey {
  if (typeof message !== "string") return codeStep ? "invalidCode" : "loginFailed";
  switch (message) {
    case "Введите телефон и пароль": return "phoneRequired";
    case "Введите email и пароль": return "emailRequired";
    case "Неверный телефон или пароль": return "invalidPhoneCredentials";
    case "Неверный email или пароль": return "invalidEmailCredentials";
    case "Слишком много попыток входа. Подождите 5 минут.":
    case "Слишком много попыток. Подождите 5 минут.": return "rateLimited";
    case "Внутренняя ошибка сервера": return "server";
    case "Telegram не привязан": return "telegramNotLinked";
    case "Не удалось отправить код в Telegram — попробуйте позже": return "telegramDelivery";
    case "Введите код": return "codeRequired";
    case "Неверный код": return "invalidCode";
    case "Код устарел — войдите заново":
    case "Код устарел — войдите заново, пришлём новый": return "expiredCode";
    case "Этот код уже использован — войдите заново": return "usedCode";
    case "Слишком много попыток — войдите заново, пришлём новый код": return "tooManyCodeAttempts";
    case "Аккаунт недоступен": return "accountUnavailable";
    case "Не удалось войти": return "loginFailed";
    case "Нет связи. Проверьте интернет и попробуйте ещё раз.": return "connectionFailed";
    default:
      return codeStep ? "invalidCode" : "loginFailed";
  }
}
