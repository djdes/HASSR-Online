/**
 * Поля окна оборудования по типу (владелец, 2026-11-23): холодильнику и датчику
 * температура нужна всегда, УФ-лампе — никогда, а металлодетектору («Другое»),
 * печи или посудомойке — по галочкам «Мин. / Макс. температура». Модуль без
 * React и Prisma — его читают окно и тесты.
 */
import { worksAtBuilding } from "@/lib/building-scope";
import { UV_LAMP_TYPE } from "@/lib/uv-lamp";

/** `always` — поля нормы видны всегда; `optional` — по галочкам; `none` — их нет. */
export type TemperatureMode = "always" | "optional" | "none";

export type EquipmentFieldProfile = {
  temperature: TemperatureMode;
  /** Поле Tuya Device ID: всегда, только при включённой температуре, никогда. */
  sensor: "always" | "withTemperature" | "never";
  /** Блок УФ-лампы (ресурс, наработка). */
  lamp: boolean;
  /** Пример нормы в подсказке поля; null — общая подсказка. */
  example: { min: string; max: string } | null;
};

const ALWAYS_COLD = { temperature: "always", sensor: "always", lamp: false } as const;

const PROFILES: Record<string, EquipmentFieldProfile> = {
  refrigerator: { ...ALWAYS_COLD, example: { min: "2", max: "6" } },
  fridge: { ...ALWAYS_COLD, example: { min: "2", max: "6" } },
  freezer: { ...ALWAYS_COLD, example: { min: "-25", max: "-18" } },
  sensor: { ...ALWAYS_COLD, example: null },
  [UV_LAMP_TYPE]: { temperature: "none", sensor: "never", lamp: true, example: null },
};

const OPTIONAL: EquipmentFieldProfile = { temperature: "optional", sensor: "withTemperature", lamp: false, example: null };

/** Поля по коду типа; термометр, печь, фритюрница, посудомойка, «Другое» и свои типы — галочки. */
export function equipmentFieldProfile(type: string): EquipmentFieldProfile {
  return PROFILES[type.trim().toLowerCase()] ?? OPTIONAL;
}

export type TemperatureToggles = { min: boolean; max: boolean };

/** Галочки при открытии окна: стоят, если норма записана (или ввод уже начат). */
export function initialTemperatureToggles(tempMin: string, tempMax: string): TemperatureToggles {
  return { min: tempMin.trim() !== "", max: tempMax.trim() !== "" };
}

/** Какие поля нормы видны при типе и галочках. */
export function visibleTemperatureFields(profile: EquipmentFieldProfile, toggles: TemperatureToggles): TemperatureToggles {
  if (profile.temperature === "always") return { min: true, max: true };
  if (profile.temperature === "none") return { min: false, max: false };
  return toggles;
}

/** Видно ли поле Tuya: у «холодного» типа — всегда, у прочих — при норме или записанном номере. */
export function sensorFieldVisible(profile: EquipmentFieldProfile, toggles: TemperatureToggles, tuyaDeviceId: string): boolean {
  if (profile.sensor === "always") return true;
  if (tuyaDeviceId.trim() !== "") return true;
  if (profile.sensor === "never") return false;
  const visible = visibleTemperatureFields(profile, toggles);
  return visible.min || visible.max;
}

/** Сотрудник для «Кто заполняет по QR»: id и объекты, где он работает. */
export type FillerScopeOption = { id: string; buildingIds?: readonly string[] };

/**
 * Кого показать в «Кто заполняет по QR» при выбранном объекте: офис — сотрудники
 * офиса, точка — сотрудники точки (правило `worksAtBuilding`: без объектов —
 * везде), без объекта — все. Уже отмеченные люди видны всегда, чтобы их можно
 * было снять.
 */
export function fillersForObject<T extends FillerScopeOption>(
  options: readonly T[],
  args: { orgBuildingIds: readonly string[]; buildingId: string | null; selectedIds?: readonly string[] },
): T[] {
  if (!args.buildingId || !args.orgBuildingIds.includes(args.buildingId)) return [...options];
  const selected = new Set(args.selectedIds ?? []);
  const buildingId = args.buildingId;
  return options.filter(
    (option) => selected.has(option.id) || worksAtBuilding(args.orgBuildingIds, option.buildingIds ?? [], buildingId),
  );
}

/** Отметки, которые остаются после смены объекта: только люди, работающие на нём. */
export function keepFillersOfObject(
  selectedIds: readonly string[],
  options: readonly FillerScopeOption[],
  args: { orgBuildingIds: readonly string[]; buildingId: string | null },
): string[] {
  const allowed = new Set(fillersForObject(options, { ...args, selectedIds: [] }).map((option) => option.id));
  return selectedIds.filter((id) => allowed.has(id));
}
