/**
 * Тексты отказов при входе из Telegram — общие для сервера и экрана.
 *
 * Сервер (`authOptions`, провайдер "telegram") бросает Error с одной из
 * этих строк, NextAuth отдаёт её клиенту как `result.error`, а главная
 * `/mini` по ней решает, что показать человеку и какую кнопку дать.
 * Поэтому строки живут в одном месте и сравниваются точно.
 *
 * Модуль намеренно без зависимостей: его тянет клиентский бандл, а
 * проверка подписи (`telegram-init-data.ts`) использует node:crypto.
 */

export type TelegramSignInProblem =
  /** Подпись просрочена: приложение провисело открытым дольше суток. */
  | "expired"
  /** Подпись не сошлась или данные битые — повтор не поможет. */
  | "not-confirmed";

export const TELEGRAM_SIGN_IN_MESSAGES: Record<TelegramSignInProblem, string> = {
  expired:
    "Сессия Telegram устарела. Закройте приложение и откройте его из бота заново.",
  "not-confirmed":
    "Telegram не подтвердил вход. Закройте приложение и откройте его из бота заново.",
};

/** Вход через Telegram не настроен на сервере — человеку повторять нечего. */
export const TELEGRAM_SIGN_IN_NOT_CONFIGURED =
  "Вход через Telegram пока не настроен. Сообщите руководителю.";

/**
 * Код проверки подписи → текст для человека.
 * Значения кодов — `InitDataVerifyError` из `telegram-init-data.ts`.
 */
export function telegramSignInMessageFor(error: string): string {
  if (error === "stale") return TELEGRAM_SIGN_IN_MESSAGES.expired;
  if (error === "missing-token") return TELEGRAM_SIGN_IN_NOT_CONFIGURED;
  return TELEGRAM_SIGN_IN_MESSAGES["not-confirmed"];
}

/**
 * Обратное превращение: по тексту ошибки понять, что случилось, и
 * решить, предлагать ли повтор (при этих двух — не предлагать).
 */
export function telegramSignInProblemFromMessage(
  message: string | null | undefined,
): TelegramSignInProblem | null {
  const text = (message ?? "").trim();
  if (!text) return null;
  if (text === TELEGRAM_SIGN_IN_MESSAGES.expired) return "expired";
  if (text === TELEGRAM_SIGN_IN_MESSAGES["not-confirmed"]) {
    return "not-confirmed";
  }
  return null;
}
