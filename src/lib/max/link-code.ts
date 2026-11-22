import { createHash, randomInt } from "node:crypto";

/**
 * Привязка MAX по коду (владелец, 2026-11-22: «продумай привязку для всех,
 * кто работает на сайте, — через пин-код или ещё как-то»). Ссылка и QR
 * остаются; рядом сайт показывает шесть цифр. Человек открывает бота в MAX
 * на любом телефоне и отправляет код сообщением — бот находит заявку и, как
 * после ссылки, просит подтвердить привязку на сайте («Это ваш аккаунт MAX?»).
 *
 * Код живёт столько же, сколько заявка (10 минут), в базе — только хэш;
 * среди действующих заявок коды не повторяются; попытки угадать ограничены
 * на каждого человека в MAX (`service.ts`). Подбором чужой код не даёт ничего:
 * привязку всё равно подтверждает владелец кабинета на сайте, видя имя.
 */

import { MAX_LINK_CODE_LENGTH } from "./link-code-format";

export { MAX_LINK_CODE_LENGTH, formatMaxLinkCode, parseMaxLinkCode } from "./link-code-format";

/** Шесть случайных цифр, ведущие нули допустимы. */
export function generateMaxLinkCode(random: (max: number) => number = randomInt): string {
  return String(random(10 ** MAX_LINK_CODE_LENGTH)).padStart(MAX_LINK_CODE_LENGTH, "0");
}

export function hashMaxLinkCode(code: string): string {
  return createHash("sha256").update(`max-link-code:${code}`).digest("hex");
}
