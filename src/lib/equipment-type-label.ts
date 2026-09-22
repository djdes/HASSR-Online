/**
 * Человеческое название типа оборудования. В базе тип хранится кодом
 * («refrigerator», «freezer»…), а сотруднику код ничего не говорит.
 * Неизвестное значение отдаём как есть: тип мог быть введён по-русски.
 */
const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  refrigerator: "Холодильник",
  fridge: "Холодильник",
  freezer: "Морозильник",
  oven: "Печь",
  sensor: "Датчик",
  thermometer: "Термометр",
  uv_lamp: "УФ-лампа",
  fryer: "Фритюрница",
  other: "Другое",
};

export function getEquipmentTypeLabel(type: string | null | undefined): string {
  const value = (type ?? "").trim();
  if (!value) return "";
  return EQUIPMENT_TYPE_LABELS[value.toLowerCase()] ?? value;
}
