/**
 * Мост между виджетом поддержки и AI-помощником.
 *
 * Оба пузыря висят в углу кабинета соседями внутри `(dashboard)/layout.tsx`
 * и не имеют общего родителя со стейтом. Пункт «ИИ Помощник» в поддержке
 * должен открывать существующий чат, а не заводить второй такой же, —
 * window-событие дешевле, чем контекст ради одного булева флага.
 */

export const SANPIN_CHAT_OPEN_EVENT = "wesetup:sanpin-chat-open";

/** Открыть чат; `question` — подставить в поле ввода (поиск «Спросить помощника»). */
export function openSanpinChat(question?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SANPIN_CHAT_OPEN_EVENT, { detail: { question } }));
}
