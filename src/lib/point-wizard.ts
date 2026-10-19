import type { RoomKind } from "@/lib/room-kinds";

/**
 * Мастер «+ Добавить точку» (`/settings/buildings/new`, 2026-10-18) — чистая
 * часть: типовой набор помещений и оборудования, угадывание помещения для
 * оборудования, нумерация названий и план «что будет создано». Создаёт точку
 * клиент существующими API (точка → помещения → оборудование).
 */

/** Помещение мастера: название и вид (`Room.kind`). */
export type WizardRoom = { name: string; kind: string };

export type TypicalRoomKey = "hot" | "cold" | "production" | "storage" | "wash" | "hall" | "bar";

/** Типовые помещения: подпись — `settingsManagement.points.wizard.roomNames.<key>`. */
export const TYPICAL_ROOMS: ReadonlyArray<{ key: TypicalRoomKey; kind: RoomKind; checked: boolean }> = [
  { key: "hot", kind: "kitchen", checked: true },
  { key: "cold", kind: "kitchen", checked: true },
  { key: "production", kind: "production", checked: false },
  { key: "storage", kind: "storage", checked: true },
  { key: "wash", kind: "wash", checked: true },
  { key: "hall", kind: "guest", checked: true },
  { key: "bar", kind: "bar", checked: false },
];

export type WizardEquipmentType = "refrigerator" | "freezer" | "fryer" | "uv_lamp" | "oven" | "dishwasher";

export type TypicalEquipment = {
  type: WizardEquipmentType;
  /** Сколько по умолчанию. */
  quantity: number;
  tempMin?: number;
  tempMax?: number;
  /** Где обычно стоит: сначала по названию помещения, потом по виду. */
  prefer: { name?: RegExp; kinds: RoomKind[] };
};

/** Типовое оборудование; подпись — `settingsManagement.points.equipmentTypes.<type>`. */
export const TYPICAL_EQUIPMENT: ReadonlyArray<TypicalEquipment> = [
  { type: "refrigerator", quantity: 1, tempMin: 2, tempMax: 6, prefer: { name: /холод|cold|sovuq/i, kinds: ["kitchen", "production", "storage"] } },
  { type: "freezer", quantity: 1, tempMin: -24, tempMax: -18, prefer: { name: /склад|storage|ombor/i, kinds: ["storage", "production", "kitchen"] } },
  { type: "fryer", quantity: 0, prefer: { name: /горяч|hot|issiq/i, kinds: ["kitchen", "production"] } },
  { type: "uv_lamp", quantity: 0, prefer: { name: /холод|cold|sovuq/i, kinds: ["kitchen", "production"] } },
  { type: "oven", quantity: 0, prefer: { name: /горяч|hot|issiq/i, kinds: ["kitchen", "production"] } },
  { type: "dishwasher", quantity: 0, prefer: { kinds: ["wash", "kitchen"] } },
];

/** Типовая УФ-лампа: ресурс по паспорту, поправят на странице точки. */
export const WIZARD_LAMP_HOURS = 8000;

/** Сколько одной позиции можно завести мастером. */
export const WIZARD_MAX_QUANTITY = 20;

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("ru-RU") === b.trim().toLocaleLowerCase("ru-RU");
}

/** Помещение по умолчанию для типа оборудования; помещений нет — null. */
export function guessRoom(type: WizardEquipmentType, rooms: ReadonlyArray<WizardRoom>): string | null {
  if (rooms.length === 0) return null;
  const typical = TYPICAL_EQUIPMENT.find((item) => item.type === type);
  if (typical?.prefer.name) {
    const byName = rooms.find((room) => typical.prefer.name!.test(room.name));
    if (byName) return byName.name;
  }
  for (const kind of typical?.prefer.kinds ?? []) {
    const byKind = rooms.find((room) => room.kind === kind);
    if (byKind) return byKind.name;
  }
  return rooms[0].name;
}

/** Добавить своё помещение: пустое и повтор (без учёта регистра) не добавляем. */
export function addCustomRoom(rooms: ReadonlyArray<WizardRoom>, name: string): WizardRoom[] | null {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || rooms.some((room) => sameName(room.name, clean))) return null;
  return [...rooms, { name: clean, kind: "other" }];
}

/**
 * Названия новых единиц: «Холодильник 1», «Холодильник 2»… — номер, которого
 * ещё нет в организации (два одинаковых названия не различить ни в журнале,
 * ни на QR-наклейке).
 */
export function nextEquipmentNames(label: string, count: number, taken: Iterable<string>): string[] {
  const used = new Set(Array.from(taken, (name) => name.trim().toLocaleLowerCase("ru-RU")));
  const names: string[] = [];
  for (let n = 1; names.length < count; n++) {
    const candidate = `${label} ${n}`;
    if (used.has(candidate.toLocaleLowerCase("ru-RU"))) continue;
    used.add(candidate.toLocaleLowerCase("ru-RU"));
    names.push(candidate);
  }
  return names;
}

export type WizardEquipmentRow = { type: WizardEquipmentType; quantity: number; roomName: string | null };

export type PlannedEquipment = {
  name: string;
  type: WizardEquipmentType;
  roomName: string;
  tempMin?: number;
  tempMax?: number;
};

/**
 * Оборудование к созданию: строки с количеством > 0 и помещением из списка
 * мастера, по порядку типового набора. Количество — от 0 до `WIZARD_MAX_QUANTITY`.
 */
export function planEquipment(input: {
  rows: ReadonlyArray<WizardEquipmentRow>;
  rooms: ReadonlyArray<WizardRoom>;
  labels: Record<WizardEquipmentType, string>;
  takenNames: Iterable<string>;
}): PlannedEquipment[] {
  const taken = new Set(Array.from(input.takenNames));
  const planned: PlannedEquipment[] = [];
  for (const typical of TYPICAL_EQUIPMENT) {
    const row = input.rows.find((item) => item.type === typical.type);
    const quantity = Math.max(0, Math.min(WIZARD_MAX_QUANTITY, Math.floor(row?.quantity ?? 0)));
    const room = row?.roomName ? input.rooms.find((item) => sameName(item.name, row.roomName!)) : undefined;
    if (quantity === 0 || !room) continue;
    for (const name of nextEquipmentNames(input.labels[typical.type], quantity, taken)) {
      taken.add(name);
      planned.push({
        name,
        type: typical.type,
        roomName: room.name,
        ...(typical.tempMin !== undefined ? { tempMin: typical.tempMin } : {}),
        ...(typical.tempMax !== undefined ? { tempMax: typical.tempMax } : {}),
      });
    }
  }
  return planned;
}
