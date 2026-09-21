import { localDayKey } from "@/lib/entry-defaults";
import { getUserRoleLabel, normalizeUserRole, pickPrimaryManager } from "@/lib/user-roles";

export const INTENSIVE_COOLING_TEMPLATE_CODE = "intensive_cooling";
export const INTENSIVE_COOLING_SOURCE_SLUG = "intensivecoolingjournal";
export const INTENSIVE_COOLING_DOCUMENT_TITLE =
  "Журнал контроля интенсивного охлаждения горячих блюд";
/**
 * Название документа по умолчанию.
 *
 * Было «Журнал контроля» — обрезок, по которому в списке нельзя понять,
 * что это за журнал. Подставляем полное название журнала; периода в
 * имени нет, потому что документ бессрочный (см. PERPETUAL_JOURNAL_CODES).
 */
export const INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME =
  INTENSIVE_COOLING_DOCUMENT_TITLE;

export type IntensiveCoolingRowSnapshot = {
  productionDate: string;
  productionHour: string;
  productionMinute: string;
  dishName: string;
  startTemperature: string;
  endTemperature: string;
  correctiveAction: string;
  comment: string;
  responsibleTitle: string;
  responsibleUserId: string;
};

/**
 * Audit-trail entry for an intensive-cooling row. Pushed to
 * `IntensiveCoolingRow.history` every time the row gets updated (either
 * via TasksFlow re-completion or via the document UI). `prev` is a
 * snapshot of the row's values BEFORE the update — `at` / `by` /
 * `byName` describe who made the change. Compliance requirement: the
 * journal must keep an immutable trail of all corrections.
 */
export type IntensiveCoolingRowHistoryEntry = {
  at: string;
  by: string | null;
  byName: string | null;
  prev: IntensiveCoolingRowSnapshot;
};

export type IntensiveCoolingRow = {
  id: string;
  productionDate: string;
  productionHour: string;
  productionMinute: string;
  dishName: string;
  startTemperature: string;
  endTemperature: string;
  correctiveAction: string;
  comment: string;
  responsibleTitle: string;
  responsibleUserId: string;
  /**
   * If the row was produced by a TasksFlow task completion, this carries
   * the TaskLink.rowKey so a subsequent re-completion of the same task
   * updates this row instead of appending a duplicate. Undefined for
   * manually-entered rows.
   */
  sourceRowKey?: string;
  /**
   * Append-only audit trail of edits — each entry holds the row state
   * BEFORE that edit plus who/when. Empty / undefined means the row was
   * never edited after creation.
   */
  history?: IntensiveCoolingRowHistoryEntry[];
};

export type IntensiveCoolingConfig = {
  rows: IntensiveCoolingRow[];
  dishSuggestions: string[];
  defaultResponsibleTitle: string | null;
  defaultResponsibleUserId: string | null;
  finishedAt: string | null;
};

function createId(prefix: string) {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => normalizeText(item))
    .filter((item, index, array) => item !== "" && array.indexOf(item) === index);
}

export function getResponsibleTitleByRole(role?: string | null) {
  const normalized = normalizeUserRole(role);
  if (
    normalized === "manager" ||
    normalized === "head_chef" ||
    normalized === "cook" ||
    normalized === "waiter"
  ) {
    return getUserRoleLabel(normalized);
  }
  return "Управляющий";
}

/**
 * Температура без единиц измерения. Печать и таблица сами дописывают
 * «°C», поэтому введённое «5 °C» превращалось в «5 °C °C». Запятую
 * сохраняем — это русская запись дробной температуры.
 */
export function normalizeTemperatureValue(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return "";
  return raw.replace(/\s*°?\s*[cCсС]?\s*$/u, "").trim();
}

export function createIntensiveCoolingRow(
  overrides?: Partial<IntensiveCoolingRow>
): IntensiveCoolingRow {
  // Дата по местным часам: UTC до 03:00 в Москве давал вчерашнее число.
  const today = localDayKey();
  return {
    id: overrides?.id || createId("intensive-cooling-row"),
    productionDate: normalizeText(overrides?.productionDate) || today,
    productionHour: normalizeText(overrides?.productionHour),
    productionMinute: normalizeText(overrides?.productionMinute),
    dishName: normalizeText(overrides?.dishName),
    startTemperature: normalizeTemperatureValue(overrides?.startTemperature),
    endTemperature: normalizeTemperatureValue(overrides?.endTemperature),
    correctiveAction: normalizeText(overrides?.correctiveAction),
    comment: normalizeText(overrides?.comment),
    responsibleTitle: normalizeText(overrides?.responsibleTitle),
    responsibleUserId: normalizeText(overrides?.responsibleUserId),
    ...(overrides?.sourceRowKey
      ? { sourceRowKey: normalizeText(overrides.sourceRowKey) }
      : {}),
    ...(Array.isArray(overrides?.history) && overrides.history.length > 0
      ? { history: normalizeIntensiveCoolingHistory(overrides.history) }
      : {}),
  };
}

function normalizeIntensiveCoolingHistory(
  raw: unknown
): IntensiveCoolingRowHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): IntensiveCoolingRowHistoryEntry | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const obj = item as Record<string, unknown>;
      const prevRaw = obj.prev as Record<string, unknown> | undefined;
      if (!prevRaw || typeof prevRaw !== "object") return null;
      const at = typeof obj.at === "string" ? obj.at : "";
      if (!at) return null;
      const by =
        typeof obj.by === "string" && obj.by !== "" ? obj.by : null;
      const byName =
        typeof obj.byName === "string" && obj.byName !== "" ? obj.byName : null;
      return {
        at,
        by,
        byName,
        prev: {
          productionDate: normalizeText(prevRaw.productionDate),
          productionHour: normalizeText(prevRaw.productionHour),
          productionMinute: normalizeText(prevRaw.productionMinute),
          dishName: normalizeText(prevRaw.dishName),
          startTemperature: normalizeText(prevRaw.startTemperature),
          endTemperature: normalizeText(prevRaw.endTemperature),
          correctiveAction: normalizeText(prevRaw.correctiveAction),
          comment: normalizeText(prevRaw.comment),
          responsibleTitle: normalizeText(prevRaw.responsibleTitle),
          responsibleUserId: normalizeText(prevRaw.responsibleUserId),
        },
      };
    })
    .filter(
      (item): item is IntensiveCoolingRowHistoryEntry => item !== null
    );
}

export function snapshotIntensiveCoolingRow(
  row: IntensiveCoolingRow
): IntensiveCoolingRowSnapshot {
  return {
    productionDate: row.productionDate,
    productionHour: row.productionHour,
    productionMinute: row.productionMinute,
    dishName: row.dishName,
    startTemperature: row.startTemperature,
    endTemperature: row.endTemperature,
    correctiveAction: row.correctiveAction,
    comment: row.comment,
    responsibleTitle: row.responsibleTitle,
    responsibleUserId: row.responsibleUserId,
  };
}

export function getDefaultIntensiveCoolingConfig(
  users: Array<{ id: string; name: string; role?: string | null }>,
  dishSuggestions: string[] = []
): IntensiveCoolingConfig {
  const defaultResponsibleUser = pickPrimaryManager(users);

  return {
    rows: [],
    dishSuggestions: normalizeStringList(dishSuggestions),
    defaultResponsibleTitle: getResponsibleTitleByRole(defaultResponsibleUser?.role),
    defaultResponsibleUserId: defaultResponsibleUser?.id || null,
    finishedAt: null,
  };
}

export function normalizeIntensiveCoolingConfig(
  value: unknown,
  users: Array<{ id: string; name: string; role?: string | null }> = []
): IntensiveCoolingConfig {
  const fallback = getDefaultIntensiveCoolingConfig(users);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          return createIntensiveCoolingRow(item as Partial<IntensiveCoolingRow>);
        })
        .filter((item): item is IntensiveCoolingRow => item !== null)
    : [];

  const defaultResponsibleUserId = normalizeText(record.defaultResponsibleUserId);
  const defaultResponsibleTitle = normalizeText(record.defaultResponsibleTitle);
  const finishedAt = normalizeText(record.finishedAt);

  return {
    rows,
    dishSuggestions: normalizeStringList(record.dishSuggestions),
    defaultResponsibleTitle:
      defaultResponsibleTitle || fallback.defaultResponsibleTitle,
    defaultResponsibleUserId:
      defaultResponsibleUserId || fallback.defaultResponsibleUserId,
    finishedAt: finishedAt || null,
  };
}

export function formatIntensiveCoolingDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}-${month}-${year}` : value;
}

export function formatIntensiveCoolingTime(hour: string, minute: string) {
  if (!hour && !minute) return "";
  return `${hour || "00"}:${minute || "00"}`;
}

export function formatIntensiveCoolingDateTime(row: IntensiveCoolingRow) {
  const dateLabel = formatIntensiveCoolingDate(row.productionDate);
  const timeLabel = formatIntensiveCoolingTime(
    row.productionHour,
    row.productionMinute
  );
  return timeLabel ? `${dateLabel}\n${timeLabel}` : dateLabel;
}

export function formatTemperatureLabel(value: string) {
  // Единицы срезаем и здесь — в уже сохранённых строках лежит «5 °C».
  const normalized = normalizeTemperatureValue(value);
  if (!normalized) return "—";
  return `${normalized} °C`;
}

export function getIntensiveCoolingFilePrefix() {
  return "intensive-cooling-journal";
}
