export const SENSOR_JOURNAL_CODES = ["cold_equipment_control", "climate_control"] as const;
export type SensorJournalCode = (typeof SENSOR_JOURNAL_CODES)[number];
export type JournalControls = {
  specialMode: boolean;
  sensorCamera: Partial<Record<SensorJournalCode, boolean>>;
  brakerageSetup: Partial<Record<string, "configured" | "declined">>;
};

export function isSensorJournalCode(code: unknown): code is SensorJournalCode {
  return typeof code === "string" && SENSOR_JOURNAL_CODES.some((item) => item === code);
}

export function parseJournalControls(raw: unknown): JournalControls {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const camera = source.sensorCamera && typeof source.sensorCamera === "object" ? source.sensorCamera as Record<string, unknown> : {};
  const setup = source.brakerageSetup && typeof source.brakerageSetup === "object" ? source.brakerageSetup as Record<string, unknown> : {};
  return {
    specialMode: source.specialMode === true,
    sensorCamera: Object.fromEntries(SENSOR_JOURNAL_CODES.map((code) => [code, camera[code] === true])),
    brakerageSetup: Object.fromEntries(["finished_product", "perishable_rejection"].flatMap((code) =>
      setup[code] === "configured" || setup[code] === "declined" ? [[code, setup[code]]] : [])),
  };
}

export function sensorCameraEnabled(controls: JournalControls, code: unknown): boolean {
  return !controls.specialMode && isSensorJournalCode(code) && controls.sensorCamera[code] === true;
}

export function allowsImplicitJournalResponsible(code: string): boolean {
  return code !== "finished_product" && code !== "perishable_rejection";
}

export const SPECIAL_MODE_ERROR = "В специальном режиме автоматическое создание и заполнение журналов отключены";
