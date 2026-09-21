/**
 * Человеческий текст вместо технической ошибки сети.
 *
 * Зачем: когда связь пропадает, `fetch` отклоняет промис с сообщением
 * браузера — «Failed to fetch» (Chrome), «NetworkError when attempting to
 * fetch resource» (Firefox), «Load failed» (Safari). Эти строки уходили
 * прямо на экран сотрудника через `e.message`. Уборщица видит английскую
 * фразу и не понимает, потерялась её работа или нет.
 *
 * Один помощник на всё приложение: экраны задач, формы журналов, списки.
 */

/** Текст, который видит человек при пропаже связи. */
export const NO_CONNECTION_MESSAGE =
  "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз";

const NETWORK_MARKERS = [
  "failed to fetch",
  "networkerror",
  "network error",
  "network request failed",
  "load failed",
  "fetch failed",
  "the internet connection appears to be offline",
  "err_internet_disconnected",
  "err_network_changed",
  "err_connection",
];

/** Похоже ли это на «связь пропала», а не на осмысленный ответ сервера. */
export function isFetchNetworkError(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!raw) return false;
  const text = raw.toLowerCase();
  return NETWORK_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Текст ошибки для показа человеку.
 *
 * Сетевые сообщения браузера подменяются на русскую фразу; осмысленные
 * ответы сервера («Нет доступа к журналу») остаются как есть — их писали
 * для человека и терять их нельзя.
 */
export function humanizeFetchError(
  error: unknown,
  fallback = NO_CONNECTION_MESSAGE
): string {
  if (isFetchNetworkError(error)) return NO_CONNECTION_MESSAGE;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
