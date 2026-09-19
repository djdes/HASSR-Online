import {
  normalizeSourceEquipmentId,
  resolveEquipmentRowName,
  type EquipmentDirectoryOption,
} from "@/lib/equipment-directory-link";

export const EQUIPMENT_CLEANING_TEMPLATE_CODE = "equipment_cleaning";
export const EQUIPMENT_CLEANING_SOURCE_SLUG = "equipcleanjournal";
export const EQUIPMENT_CLEANING_DOCUMENT_TITLE =
  "Журнал мойки и дезинфекции оборудования";

export type EquipmentCleaningFieldVariant =
  | "rinse_temperature"
  | "rinse_completeness";

export type EquipmentCleaningDocumentConfig = {
  fieldVariant: EquipmentCleaningFieldVariant;
};

export type EquipmentCleaningRowData = {
  washDate: string;
  washTime: string;
  equipmentName: string;
  /**
   * Связь со справочником «Оборудование». Необязательное поле: строки
   * старых журналов ссылки не имеют и работают как раньше — по тексту.
   */
  sourceEquipmentId?: string | null;
  detergentName: string;
  detergentConcentration: string;
  disinfectantName: string;
  disinfectantConcentration: string;
  rinseTemperature: string | null;
  rinseResult: "compliant" | "non_compliant" | null;
  washerPosition: string;
  washerName: string;
  washerUserId: string | null;
  controllerPosition: string;
  controllerName: string;
  controllerUserId: string | null;
};

export const EQUIPMENT_CLEANING_VARIANT_LABELS: Record<
  EquipmentCleaningFieldVariant,
  string
> = {
  rinse_temperature: '"Ополаскивание, °C"',
  rinse_completeness: '"Полнота смываемости"',
};

export function getDefaultEquipmentCleaningConfig(): EquipmentCleaningDocumentConfig {
  return {
    fieldVariant: "rinse_temperature",
  };
}

export function normalizeEquipmentCleaningConfig(
  raw: unknown
): EquipmentCleaningDocumentConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return getDefaultEquipmentCleaningConfig();
  }

  const value = (raw as { fieldVariant?: unknown }).fieldVariant;
  return {
    fieldVariant:
      value === "rinse_completeness" ? "rinse_completeness" : "rinse_temperature",
  };
}

export function getEquipmentCleaningDocumentTitle() {
  return EQUIPMENT_CLEANING_DOCUMENT_TITLE;
}

export function getEquipmentCleaningFieldVariantLabel(
  variant: EquipmentCleaningFieldVariant
) {
  return EQUIPMENT_CLEANING_VARIANT_LABELS[variant];
}

/**
 * Журнал мойки ведётся непрерывно, а не одним днём: раньше здесь было
 * `dateFrom = dateTo = сегодня`, и сервер отвечал 400 на любую мойку
 * задним числом. Период — годовой (см. `YEARLY_JOURNAL_CODES`
 * в `journal-period.ts`): от сегодня до 31 декабря текущего года.
 */
export function getEquipmentCleaningCreatePeriodBounds() {
  const today = new Date();
  const date = today.toISOString().slice(0, 10);

  return {
    dateFrom: date,
    dateTo: `${date.slice(0, 4)}-12-31`,
  };
}

/** Конец года документа — сюда «расширяется» вырожденный период. */
export function getEquipmentCleaningPeriodEnd(documentDateFrom: string) {
  return `${documentDateFrom.slice(0, 4)}-12-31`;
}

/**
 * Границы даты мойки: с начала года документа по сегодня (по поясу
 * организации). Нижнюю границу берём по году, а не по `dateFrom`, —
 * иначе старые документы с `dateFrom = dateTo = дата создания` не дают
 * внести даже вчерашнюю мойку. Верхняя — сегодня: будущее не мыли.
 */
export function getEquipmentCleaningEntryDateBounds(
  documentDateFrom: string,
  todayKey: string
) {
  const yearStart = `${documentDateFrom.slice(0, 4)}-01-01`;
  const min = documentDateFrom < yearStart ? documentDateFrom : yearStart;
  return { min, max: todayKey };
}

export function isEquipmentCleaningDateAllowed(
  washDate: string,
  documentDateFrom: string,
  todayKey: string
) {
  const { min, max } = getEquipmentCleaningEntryDateBounds(
    documentDateFrom,
    todayKey
  );
  return washDate >= min && washDate <= max;
}

export function emptyEquipmentCleaningRow(
  overrides: Partial<EquipmentCleaningRowData> = {}
): EquipmentCleaningRowData {
  const now = new Date();

  return {
    // Дата — МЕСТНАЯ: toISOString() отдавал UTC-день, и рядом с местным
    // washTime строка уезжала на сутки назад (в МСК — до 03:00).
    washDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}`,
    washTime: `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`,
    equipmentName: "",
    sourceEquipmentId: null,
    detergentName: "",
    detergentConcentration: "",
    disinfectantName: "",
    disinfectantConcentration: "",
    rinseTemperature: "",
    rinseResult: "compliant",
    washerPosition: "",
    washerName: "",
    washerUserId: null,
    controllerPosition: "",
    controllerName: "",
    controllerUserId: null,
    ...overrides,
  };
}

export function normalizeEquipmentCleaningRowData(
  raw: unknown
): EquipmentCleaningRowData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyEquipmentCleaningRow();
  }

  const value = raw as Record<string, unknown>;

  return emptyEquipmentCleaningRow({
    washDate:
      typeof value.washDate === "string"
        ? value.washDate
        : new Date().toISOString().slice(0, 10),
    washTime:
      typeof value.washTime === "string" && value.washTime
        ? value.washTime.slice(0, 5)
        : "00:00",
    equipmentName:
      typeof value.equipmentName === "string" ? value.equipmentName : "",
    sourceEquipmentId: normalizeSourceEquipmentId(value.sourceEquipmentId),
    detergentName:
      typeof value.detergentName === "string" ? value.detergentName : "",
    detergentConcentration:
      typeof value.detergentConcentration === "string"
        ? value.detergentConcentration
        : "",
    disinfectantName:
      typeof value.disinfectantName === "string" ? value.disinfectantName : "",
    disinfectantConcentration:
      typeof value.disinfectantConcentration === "string"
        ? value.disinfectantConcentration
        : "",
    rinseTemperature:
      typeof value.rinseTemperature === "string" ? value.rinseTemperature : "",
    rinseResult:
      value.rinseResult === "non_compliant"
        ? "non_compliant"
        : value.rinseResult === "compliant"
          ? "compliant"
          : null,
    washerPosition:
      typeof value.washerPosition === "string" ? value.washerPosition : "",
    washerName: typeof value.washerName === "string" ? value.washerName : "",
    washerUserId:
      typeof value.washerUserId === "string" ? value.washerUserId : null,
    controllerPosition:
      typeof value.controllerPosition === "string"
        ? value.controllerPosition
        : "",
    controllerName:
      typeof value.controllerName === "string" ? value.controllerName : "",
    controllerUserId:
      typeof value.controllerUserId === "string" ? value.controllerUserId : null,
  });
}

/**
 * Имя оборудования строки для экрана и печати: из справочника, если
 * строка с ним связана, иначе — сохранённый в журнале текст (единицу
 * могли удалить, а строку журнала предъявляют инспектору).
 */
export function resolveEquipmentCleaningRowName(
  row: Pick<EquipmentCleaningRowData, "equipmentName" | "sourceEquipmentId">,
  directory: readonly EquipmentDirectoryOption[]
): string {
  return resolveEquipmentRowName(row, directory);
}

export function getEquipmentCleaningPeriodLabel(dateFrom: Date | string) {
  const value =
    typeof dateFrom === "string" ? new Date(`${dateFrom}T00:00:00`) : dateFrom;

  return value.toLocaleDateString("ru-RU").replaceAll(".", "-");
}

export function formatEquipmentCleaningDate(date: string) {
  return date.split("-").reverse().join("-");
}

export function getEquipmentCleaningResultLabel(
  value: EquipmentCleaningRowData["rinseResult"]
) {
  if (value === "non_compliant") return "Не соответствует";
  // Незаполненное — пусто: раньше null печатался как «Соответствует».
  if (value === "compliant") return "Соответствует";
  return "";
}
