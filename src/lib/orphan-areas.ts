/**
 * Цеха без помещения (Area без Room с тем же названием).
 *
 * Area (/settings/areas — «Цеха и участки», для оборудования) и Room
 * (/settings/buildings — помещения для уборки/климата) живут раздельно.
 * Помещение при создании зеркалит цех, а обратного зеркала раньше не было:
 * «Основное производство», заведённое как цех, не попадало в окно
 * «Добавить помещение». Здесь — чистые функции сравнения и угадывания
 * типа помещения по названию (без БД, с тестами).
 */

/** Нормализация названия для сравнения: регистр, ё→е, пробелы. */
export function normalizePlaceName(name: string): string {
  return name.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Цеха, для которых нет помещения с тем же (нормализованным) названием. */
export function orphanAreas<T extends { id: string; name: string }>(
  areas: ReadonlyArray<T>,
  roomNames: ReadonlyArray<string>,
): T[] {
  const taken = new Set(roomNames.map(normalizePlaceName));
  return areas.filter((a) => {
    const key = normalizePlaceName(a.name);
    return key.length > 0 && !taken.has(key);
  });
}

export type GuessedRoomKind = "guest" | "kitchen" | "wash" | "bar" | "storage" | "other";

/** Тип помещения (Room.kind) по названию цеха. */
export function guessRoomKind(name: string): GuessedRoomKind {
  const n = normalizePlaceName(name);
  if (n.includes("склад")) return "storage";
  if (/(^|[^а-я])бар/.test(n)) return "bar";
  if (n.includes("мойк") || n.includes("моечн")) return "wash";
  if (/(^|[^а-я])зал/.test(n) || n.includes("гост")) return "guest";
  if (/цех|кухн|производ|заготов/.test(n)) return "kitchen";
  return "other";
}
