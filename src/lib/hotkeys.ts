/**
 * Горячие клавиши кабинета: «/» — поиск журналов, «?» — список клавиш,
 * ⌘K / Ctrl+K — палитра, ⌘⇧N / Ctrl+Shift+N — срочный журнал. Чистые
 * функции — их берут обработчики клавиш и тест.
 */

/** Человек печатает в поле — одиночные клавиши («/», «?») не перехватываем. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: string; isContentEditable?: boolean; getAttribute?: (name: string) => string | null };
  const tag = String(element.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (element.isContentEditable) return true;
  const role = element.getAttribute?.("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

/** Список клавиш для окна «?»: ключ подписи и сочетание. */
export const HOTKEYS: ReadonlyArray<{ id: "palette" | "search" | "urgent" | "help"; keys: string[] }> = [
  { id: "palette", keys: ["Ctrl", "K"] },
  { id: "search", keys: ["/"] },
  { id: "urgent", keys: ["Ctrl", "Shift", "N"] },
  { id: "help", keys: ["?"] },
];
