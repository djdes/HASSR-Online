/**
 * Код привязки MAX без серверных модулей: разбор сообщения боту и вид кода
 * на странице подключения. Генерация и хэш — `link-code.ts` (node:crypto).
 */

export const MAX_LINK_CODE_LENGTH = 6;

/**
 * Сообщение боту — это код, только если в нём ровно шесть цифр и ничего,
 * кроме пробелов и дефисов между ними («482913», «482 913», «482-913»).
 * Иначе `null`: обычные ответы в чате кодом не считаются.
 */
export function parseMaxLinkCode(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[\d\s-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/[\s-]/g, "");
  return digits.length === MAX_LINK_CODE_LENGTH ? digits : null;
}

/** «482913» → «482 913»: так код легче прочитать и набрать. */
export function formatMaxLinkCode(code: string): string {
  return code.length === MAX_LINK_CODE_LENGTH ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
