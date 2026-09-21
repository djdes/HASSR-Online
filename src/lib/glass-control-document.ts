import { isBlankEntryData } from "@/lib/journal-entry-blank";

export const GLASS_CONTROL_TEMPLATE_CODE = "glass_control";
export const GLASS_CONTROL_SOURCE_SLUG = "glassjournal";
export const GLASS_CONTROL_PAGE_TITLE =
  "Журнал контроля изделий из стекла и хрупкого пластика";
/**
 * Название документа по умолчанию.
 *
 * Было «Журнал контроля изделий» — обрезок: каких изделий, непонятно.
 * Подставляем полное название журнала; периода в имени нет, потому что
 * документ бессрочный (см. PERPETUAL_JOURNAL_CODES).
 */
export const GLASS_CONTROL_DOCUMENT_TITLE = GLASS_CONTROL_PAGE_TITLE;
export const GLASS_CONTROL_DEFAULT_FREQUENCY = "1 раз в сутки";

export type GlassControlDocumentConfig = {
  documentName: string;
  controlFrequency: string;
};

export type GlassControlEntryData = {
  damagesDetected: boolean;
  itemName: string;
  quantity: string;
  damageInfo: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function formatRuDateDash(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("ru-RU").replaceAll(".", "-");
}

export function buildDailyRange(from: string, to: string) {
  const result: string[] = [];
  const current = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  while (current <= end) {
    result.push(toIsoDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return result;
}

export function getDefaultGlassControlConfig(): GlassControlDocumentConfig {
  return {
    documentName: GLASS_CONTROL_DOCUMENT_TITLE,
    controlFrequency: GLASS_CONTROL_DEFAULT_FREQUENCY,
  };
}

export function normalizeGlassControlConfig(
  value: unknown
): GlassControlDocumentConfig {
  const defaults = getDefaultGlassControlConfig();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const item = value as Record<string, unknown>;
  return {
    documentName:
      normalizeText(item.documentName) || GLASS_CONTROL_DOCUMENT_TITLE,
    controlFrequency:
      normalizeText(item.controlFrequency) || GLASS_CONTROL_DEFAULT_FREQUENCY,
  };
}

export function normalizeGlassControlEntryData(
  value: unknown
): GlassControlEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      damagesDetected: false,
      itemName: "",
      quantity: "",
      damageInfo: "",
    };
  }

  const item = value as Record<string, unknown>;
  return {
    damagesDetected: item.damagesDetected === true,
    itemName: normalizeText(item.itemName),
    quantity: normalizeText(item.quantity),
    damageInfo: normalizeText(item.damageInfo),
  };
}

/**
 * Строка автозаполнения: контроль проведён, повреждений не выявлено.
 * Любое реальное повреждение — событие, его вносит человек; автомат
 * фиксирует только штатный «осмотр без замечаний».
 */
export function buildGlassControlAutoFillEntryData(): GlassControlEntryData {
  return {
    damagesDetected: false,
    itemName: "",
    quantity: "",
    damageInfo: "",
  };
}

/**
 * Строки таблицы бланка «контроль стекла».
 *
 * КРИТИЧНО: заготовка строки (запись есть, но человек в неё ничего не
 * вносил — `{}` / `{_autoSeeded:true}`) печатается ПУСТОЙ: без «V» в
 * колонке «Нет» и без фамилии. Раньше нормализация достраивала
 * `damagesDetected:false`, и бланк на каждый день периода утверждал,
 * что осмотр проведён и повреждений не выявлено, хотя журнал никто не
 * вёл. Это подлог данных перед инспектором.
 */
export function buildGlassControlPdfRows(params: {
  entries: Array<{ date: Date; employeeId: string; data: unknown }>;
  formatDate: (date: Date) => string;
  resolveUserName: (employeeId: string) => string;
}): string[][] {
  return params.entries.map((entry) => {
    if (isBlankEntryData(entry.data)) {
      return [params.formatDate(entry.date), "", "", "", "", "", ""];
    }
    const data = normalizeGlassControlEntryData(entry.data);
    return [
      params.formatDate(entry.date),
      data.damagesDetected ? "V" : "",
      data.damagesDetected ? "" : "V",
      data.itemName,
      data.quantity,
      data.damageInfo,
      params.resolveUserName(entry.employeeId),
    ];
  });
}

export function getGlassControlResponsibleOptions(
  users: Array<{ id: string; name: string; role: string }>
) {
  // Канонические management-роли + legacy. Раньше: только legacy
  // owner+technologist → у новых орг-ов в UI секция «Управление»
  // была пустой, все попадали в «Сотрудники».
  const managementRoles = new Set([
    "manager",
    "head_chef",
    "owner",
    "technologist",
  ]);
  const management = users.filter((user) => managementRoles.has(user.role));
  const staff = users.filter((user) => !managementRoles.has(user.role));

  return {
    titles: [
      "Управляющий",
      "Технолог",
      "Заведующий производством",
      "Кладовщик",
      "Повар",
    ],
    management,
    staff,
  };
}

export function getGlassControlFilePrefix() {
  return "glass-control-journal";
}
