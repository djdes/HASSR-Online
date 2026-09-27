/**
 * Значение динамического сегмента пути (`[equipmentId]`, `[roomId]`, `[id]`).
 *
 * Next 16 отдаёт его в `params` НЕраскодированным: адрес
 * `/equipment-fill/platform-%D0%93…%20…` приходит как
 * `"platform-%D0%93…%20…"`, а id в подписанном токене из `?token=` уже
 * раскодирован (`"platform-Горячий цех…"`). Из-за этого 27.09.2026 все
 * наклейки оборудования организации WeSetup показывали «Ссылка
 * недействительна»: подпись верная, но id «не совпадал». Затронуты объекты,
 * чей id не из латиницы/цифр — такие создавали демо-сиды
 * (`${organization.id}-${area.name}`); у клиентов id — cuid, у них работало.
 *
 * Раскодируем один раз; битая `%`-последовательность — значение как есть
 * (дальше оно просто не совпадёт с токеном, как любой чужой id).
 */
export function decodeRouteParam(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Сегмент пути из id объекта: кириллица, пробелы и `/` — только в закодированном виде. */
export function encodeRouteParam(value: string): string {
  return encodeURIComponent(value);
}
