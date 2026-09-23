/**
 * Формулировки оценки бракеража (решение владельца 2026-09-23):
 * «Доброкачественно» / «Недоброкачественно» вместо «Доброкачественная» /
 * «Недоброкачественная» («Не доброкачественная»). Готовая продукция хранит
 * текст — старые записи переводятся при нормализации, в базу напрямую не
 * пишем: документ запишет новое слово при следующем сохранении.
 * Прочий текст (фритюр «Доброкачественное, без…») не трогаем.
 */
const LEGACY_GRADES: ReadonlyArray<[RegExp, string]> = [
  [/^не\s*доброкачественная$/i, "недоброкачественно"],
  [/^доброкачественная$/i, "доброкачественно"],
];

export function modernizeGradeWording(value: string): string {
  const trimmed = value.trim();
  for (const [pattern, replacement] of LEGACY_GRADES) {
    if (!pattern.test(trimmed)) continue;
    const first = trimmed[0];
    const upper = first === first.toLocaleUpperCase("ru") && first !== first.toLocaleLowerCase("ru");
    return upper ? replacement[0].toLocaleUpperCase("ru") + replacement.slice(1) : replacement;
  }
  return value;
}
