/**
 * Состояние страницы «Моя компания → Офис» (2026-11-12).
 *
 * Офис выделяется, как только есть хотя бы одна торговая точка: офис +
 * точка — уже два места, и выделение офиса само включает журналы по
 * точкам. Раньше страница ждала тумблера «журналы по точкам», а он
 * включается только при двух зданиях — с одной точкой путь был закрыт.
 *
 * - `ready` — офис есть и журналы ведутся по местам: сотрудники и журналы офиса;
 * - `create` — есть точка: кнопка «Выделить офис» (создаёт офис и включает деление);
 * - `noPoints` — точек нет: сначала добавить торговую точку.
 */
export type OfficeSetupState = "ready" | "create" | "noPoints";

export function officeSetupState(input: {
  perLocationJournals: boolean;
  hasOffice: boolean;
  pointCount: number;
}): OfficeSetupState {
  if (input.pointCount < 1) return "noPoints";
  if (input.hasOffice && input.perLocationJournals) return "ready";
  return "create";
}
