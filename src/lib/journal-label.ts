/**
 * Подписи и иконки задач по виду журнала — один помощник на экран
 * задачи и на список «Сегодня».
 *
 * Зачем:
 *   • Иконка. Раньше у любой задачи стоял термометр, и уборщица,
 *     открывая «Уборку зала», видела градусник. Незнакомый человек
 *     читает картинку раньше текста, и она не должна врать.
 *   • Подпись. Название документа в базе бывает служебным («Проверка
 *     health_check», «E2E doc 12»), и оно уезжало в список задач как
 *     есть. Такую подпись подменяем названием журнала.
 *
 * Иконки лежат ИМЕНАМИ: модуль читают и серверные маршруты, а функции
 * (какими являются компоненты lucide) через границу RSC не передаются.
 * Соответствие «имя → компонент» держат клиентские компоненты.
 */

export type JournalIconName =
  | "Sparkles"
  | "HeartPulse"
  | "Thermometer"
  | "Droplets"
  | "Utensils"
  | "ShieldCheck"
  | "ClipboardList";

/** Иконка задачи по коду журнала. Ничего не подошло — нейтральный планшет. */
export function journalIconName(journalCode: string): JournalIconName {
  const code = (journalCode ?? "").toLowerCase();
  if (code.includes("clean") || code.includes("sanitary") || code.includes("sanitation") || code.includes("disinfect")) {
    return "Sparkles";
  }
  if (code.includes("health") || code.includes("med")) return "HeartPulse";
  if (
    code.includes("temp") ||
    code.includes("cold") ||
    code.includes("climate") ||
    code.includes("fridge") ||
    code.includes("cooling")
  ) {
    return "Thermometer";
  }
  if (code.includes("hygien")) return "Droplets";
  if (code.includes("food") || code.includes("dish") || code.includes("product")) {
    return "Utensils";
  }
  if (code.includes("control") || code.includes("audit")) return "ShieldCheck";
  return "ClipboardList";
}

/**
 * Похоже ли название на служебный код, а не на человеческий заголовок.
 *
 * Ловим три случая, которые реально встречались в базе:
 *   • голая латиница с подчёркиваниями — `health_check`;
 *   • «Проверка health_check» — шаблонная заглушка автосоздания;
 *   • `E2E …` — следы тестовых прогонов.
 */
export function looksLikeJournalCode(title: string | null | undefined): boolean {
  const text = (title ?? "").trim();
  if (!text) return true;
  if (/^e2e\b/i.test(text)) return true;
  // «Проверка <code>» и прочие «<слово> <code>»: код узнаём по
  // латинице с подчёркиванием.
  if (/(^|\s)[a-z][a-z0-9]*(_[a-z0-9]+)+(\s|$)/.test(text.toLowerCase())) {
    return true;
  }
  // Целиком латиница без единой кириллической буквы и без пробелов.
  if (/^[a-z0-9_-]+$/i.test(text)) return true;
  return false;
}

/**
 * Подпись задачи: название документа, если оно человеческое, иначе —
 * название журнала.
 */
export function humanTaskLabel(
  documentTitle: string | null | undefined,
  journalName: string
): string {
  return looksLikeJournalCode(documentTitle)
    ? journalName
    : (documentTitle as string).trim();
}
