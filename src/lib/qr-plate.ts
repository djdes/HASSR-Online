/**
 * Табличка на холодильное оборудование (2026-10-27, AC7): «ХОЛОД» или
 * «МОРОЗ», температурный режим, номер, цех и QR для записи температуры.
 * Чистые функции без БД — client-safe (типы плаката, лист печати, тесты).
 */

export type EquipmentPlate = {
  word: "ХОЛОД" | "МОРОЗ";
  /** «+2…+4 °C», «не выше −18 °C». */
  regime: string;
  /** Номер в цехе: число из конца названия, иначе порядок по названию. */
  number: number;
  /** Цех (участок), где стоит оборудование. */
  area: string;
};

/** МОРОЗ, когда верхняя граница режима не выше −5 °C (морозильник), иначе ХОЛОД. */
export function plateWord(tempMin: number | null, tempMax: number | null): EquipmentPlate["word"] {
  const reference = tempMax ?? tempMin;
  return reference !== null && reference <= -5 ? "МОРОЗ" : "ХОЛОД";
}

/** Число с настоящим минусом (U+2212) и плюсом у положительных; 0 — без знака. */
export function plateDegrees(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

export function plateRegime(tempMin: number | null, tempMax: number | null): string | null {
  if (tempMin !== null && tempMax !== null) {
    return tempMin === tempMax ? `${plateDegrees(tempMin)} °C` : `${plateDegrees(tempMin)}…${plateDegrees(tempMax)} °C`;
  }
  if (tempMax !== null) return `не выше ${plateDegrees(tempMax)} °C`;
  if (tempMin !== null) return `не ниже ${plateDegrees(tempMin)} °C`;
  return null;
}

/** Число в конце названия («Холодильник №3», «Морозильник 12») или порядок в цехе (с 1). */
export function plateNumber(name: string, indexInArea: number): number {
  const trailing = /(\d{1,4})\s*$/.exec(name.trim());
  return trailing ? Number(trailing[1]) : indexInArea + 1;
}

type PlateSource = {
  name: string;
  tempMin: number | null;
  tempMax: number | null;
  area: { name: string };
  /** УФ-лампа или фритюрница: температуры нет, таблички нет. */
  equipmentKind?: "uv" | "fryer" | null;
};

/** Табличка оборудования; null — температуры нет (лампа, фритюрница, пустой режим). */
export function buildEquipmentPlate(item: PlateSource, indexInArea: number): EquipmentPlate | null {
  if (item.equipmentKind) return null;
  const regime = plateRegime(item.tempMin, item.tempMax);
  if (!regime) return null;
  return {
    word: plateWord(item.tempMin, item.tempMax),
    regime,
    number: plateNumber(item.name, indexInArea),
    area: item.area.name,
  };
}

/**
 * Порядок внутри цеха: по названию. Вход — всё оборудование организации;
 * ответ — id → индекс в своём цеху (с 0).
 */
export function indexEquipmentInAreas(items: ReadonlyArray<{ id: string; name: string; area: { name: string } }>): Map<string, number> {
  const byArea = new Map<string, Array<{ id: string; name: string }>>();
  for (const item of items) {
    const list = byArea.get(item.area.name) ?? [];
    list.push(item);
    byArea.set(item.area.name, list);
  }
  const result = new Map<string, number>();
  for (const list of byArea.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    list.forEach((item, index) => result.set(item.id, index));
  }
  return result;
}
