/**
 * Пауза обмена справочниками (серия D, Р1): переменная окружения сервера
 * `DIRECTORY_EXCHANGE_PAUSED=1` (в `.env`, затем `pm2 restart`). Пока она
 * включена, обмен (кнопка, сохранение настроек, подтверждение запроса, план)
 * не идёт: `runDirectoryExchange` отказывает с 409, как «занято», плановый
 * обмен кабинет пропускает. Нужна на время отката версий отпечатка
 * (`docs/directory-exchange-rollback.md`): иначе обмен нынешнего кода вернул
 * бы откатанные связи на новую версию. Разовые переносы связей не пишут — их
 * пауза не трогает. Чистый модуль.
 */

export const EXCHANGE_PAUSE_ENV = "DIRECTORY_EXCHANGE_PAUSED";
export const EXCHANGE_PAUSED_MESSAGE = "Обмен справочниками временно приостановлен. Повторите позже.";

/** Пауза включена: `1`, `true`, `yes` или `on` (без учёта регистра и пробелов). */
export function isExchangePaused(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[EXCHANGE_PAUSE_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
