export const SENSOR_JOURNAL_CODES = ["cold_equipment_control", "climate_control"] as const;
export type SensorJournalCode = (typeof SENSOR_JOURNAL_CODES)[number];

/**
 * «Спецрежим» (с 2026-10-28 — наоборот): по умолчанию автоматика журналов
 * скрыта и выключена; руководитель включает спецрежим и галочками выбирает,
 * что из автоматики появится в журналах. Каждая галочка — своя часть:
 *   • autoFill — автозаполнение журналов (тумблеры в документах, кроны);
 *   • autoCreate — автосоздание документов на новый период;
 *   • copyYesterday — «Скопировать вчерашнее» в документах;
 *   • closeDayAutofill — «Автозаполнить» на главной (закрыть день).
 * Фото датчиков в спецрежим не входит — у него своя настройка по журналу.
 */
export const AUTOMATION_FEATURES = ["autoFill", "autoCreate", "copyYesterday", "closeDayAutofill"] as const;
export type AutomationFeature = (typeof AUTOMATION_FEATURES)[number];
export type JournalAutomationControls = { enabled: boolean } & Record<AutomationFeature, boolean>;

export type JournalControls = {
  automation: JournalAutomationControls;
  sensorCamera: Partial<Record<SensorJournalCode, boolean>>;
  brakerageSetup: Partial<Record<string, "configured" | "declined">>;
};

/** Ничего из автоматики не видно и не работает — новая организация. */
export const AUTOMATION_OFF: Readonly<JournalAutomationControls> = Object.freeze({
  enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false,
});
/** Всё как было до 2026-10-28 — организация, которая автоматикой пользовалась. */
export const AUTOMATION_ALL_ON: Readonly<JournalAutomationControls> = Object.freeze({
  enabled: true, autoFill: true, autoCreate: true, copyYesterday: true, closeDayAutofill: true,
});

/**
 * Выкладка «спецрежима наоборот». Организация, созданная раньше и уже
 * пользовавшаяся автоматикой, сохраняет её (спецрежим включён со всеми
 * галочками); созданная позже — начинает с выключенного.
 */
export const SPECIAL_MODE_INVERSION_CUTOFF = new Date("2026-10-28T00:00:00+03:00");

export function isSensorJournalCode(code: unknown): code is SensorJournalCode {
  return typeof code === "string" && SENSOR_JOURNAL_CODES.some((item) => item === code);
}

function toRecord(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseAutomation(raw: unknown): JournalAutomationControls | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  return {
    enabled: source.enabled === true,
    autoFill: source.autoFill === true,
    autoCreate: source.autoCreate === true,
    copyYesterday: source.copyYesterday === true,
    closeDayAutofill: source.closeDayAutofill === true,
  };
}

/**
 * Что лежит в настройке: явный выбор `automation` (сохранён окном
 * спецрежима) или ничего — тогда решает {@link resolveLegacyAutomation}.
 * `legacySpecialMode` — прежний флаг «всё скрыто», читается только здесь.
 */
export function readStoredAutomation(raw: unknown): { automation: JournalAutomationControls | null; legacySpecialMode: boolean } {
  const source = toRecord(raw);
  return { automation: parseAutomation(source.automation), legacySpecialMode: source.specialMode === true };
}

/**
 * Правило для организаций без сохранённого выбора:
 *   1. прежний «спецрежим» включён (всё было скрыто) → выключено;
 *   2. создана до выкладки и пользуется автоматикой → включено всё;
 *   3. иначе → выключено.
 */
export function resolveLegacyAutomation(input: {
  legacySpecialMode: boolean;
  createdAt: Date | null | undefined;
  usesAutomation: boolean;
}): JournalAutomationControls {
  if (input.legacySpecialMode) return { ...AUTOMATION_OFF };
  const before = input.createdAt instanceof Date && input.createdAt.getTime() < SPECIAL_MODE_INVERSION_CUTOFF.getTime();
  return before && input.usesAutomation ? { ...AUTOMATION_ALL_ON } : { ...AUTOMATION_OFF };
}

/**
 * Разбор настройки. Без сохранённого `automation` — выключено (так видит
 * клиент до ответа сервера: fail-closed); сервер подставляет правило
 * {@link resolveLegacyAutomation} в `getJournalControls`.
 */
export function parseJournalControls(raw: unknown): JournalControls {
  const source = toRecord(raw);
  const camera = source.sensorCamera && typeof source.sensorCamera === "object" ? source.sensorCamera as Record<string, unknown> : {};
  const setup = source.brakerageSetup && typeof source.brakerageSetup === "object" ? source.brakerageSetup as Record<string, unknown> : {};
  return {
    automation: parseAutomation(source.automation) ?? { ...AUTOMATION_OFF },
    sensorCamera: Object.fromEntries(SENSOR_JOURNAL_CODES.map((code) => [code, camera[code] === true])),
    brakerageSetup: Object.fromEntries(["finished_product", "perishable_rejection"].flatMap((code) =>
      setup[code] === "configured" || setup[code] === "declined" ? [[code, setup[code]]] : [])),
  };
}

/** Видна и работает ли эта часть автоматики: спецрежим включён и галочка стоит. */
export function automationOn(controls: Pick<JournalControls, "automation">, feature: AutomationFeature): boolean {
  return controls.automation.enabled && controls.automation[feature] === true;
}

/** Фото датчиков — своя настройка журнала, спецрежим на неё не влияет. */
export function sensorCameraEnabled(controls: JournalControls, code: unknown): boolean {
  return isSensorJournalCode(code) && controls.sensorCamera[code] === true;
}

export function allowsImplicitJournalResponsible(code: string): boolean {
  return code !== "finished_product" && code !== "perishable_rejection";
}

const FEATURE_TITLES: Record<AutomationFeature, string> = {
  autoFill: "«Автозаполнение журналов»",
  autoCreate: "«Автосоздание документов»",
  copyYesterday: "«Скопировать вчерашнее»",
  closeDayAutofill: "«Автозаполнить» на главной",
};

/** Ответ сервера, когда эта часть автоматики выключена в спецрежиме. */
export function automationDisabledError(feature: AutomationFeature): string {
  return `Функция ${FEATURE_TITLES[feature]} выключена. Включить её: «Пришла проверка» → «Спецрежим».`;
}
