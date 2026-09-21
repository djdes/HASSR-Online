/**
 * «Должность + имя» одной строкой — для шапок бланков, карточек и
 * подписей «Ответственный: …».
 *
 * ПОЧЕМУ отдельный помощник: в трёх журналах подпись собиралась
 * шаблоном `${role}: ${name}` / `${role}, ${name}`, и когда сотрудник не
 * выбран, на экране и в печати оставалось «Ответственный: Управляющий:»
 * — двоеточие (или запятая) с пустотой после. Теперь разделитель ставится
 * только между двумя НЕПУСТЫМИ частями; если нет ничего — пустая строка
 * (или `emptyValue`, например «—»).
 */
export function formatPositionWithName(
  position: string | null | undefined,
  name: string | null | undefined,
  options: { separator?: string; emptyValue?: string } = {}
): string {
  const separator = options.separator ?? ": ";
  const role = String(position ?? "").trim();
  const person = String(name ?? "").trim();
  if (role && person) return `${role}${separator}${person}`;
  return role || person || options.emptyValue || "";
}
