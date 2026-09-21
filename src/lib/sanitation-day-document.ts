import { formatPositionWithName } from "@/lib/position-name-label";

export const SANITATION_DAY_TEMPLATE_CODE = "general_cleaning";
export const SANITATION_DAY_SOURCE_SLUG = "sanitationdayjournal";

export const SANITATION_DAY_HEADING = "График и учет генеральных уборок";
export const SANITATION_DAY_DOCUMENT_TITLE = "График ген. уборок";

export const SANITATION_MONTHS = [
  { key: "jan", short: "Янв", label: "Январь" },
  { key: "feb", short: "Фев", label: "Февраль" },
  { key: "mar", short: "Мар", label: "Март" },
  { key: "apr", short: "Апр", label: "Апрель" },
  { key: "may", short: "Май", label: "Май" },
  { key: "jun", short: "Июн", label: "Июнь" },
  { key: "jul", short: "Июл", label: "Июль" },
  { key: "aug", short: "Авг", label: "Август" },
  { key: "sep", short: "Сен", label: "Сентябрь" },
  { key: "oct", short: "Окт", label: "Октябрь" },
  { key: "nov", short: "Ноя", label: "Ноябрь" },
  { key: "dec", short: "Дек", label: "Декабрь" },
] as const;

export type SanitationMonthKey = (typeof SANITATION_MONTHS)[number]["key"];

export type SanitationMonthValues = Record<SanitationMonthKey, string>;

export type SanitationRoomRow = {
  id: string;
  /**
   * 2026-09-04: связь со справочником помещений (Room.id). Если задана и
   * помещение живо — название берётся из Room
   * (applyRoomDirectoryToSanitationConfig); roomName остаётся снапшотом.
   * Строки без связи — legacy (свободный текст) — предлагаем «Связать».
   */
  roomId?: string;
  roomName: string;
  plan: SanitationMonthValues;
  fact: SanitationMonthValues;
};

/** Помещение справочника — минимум для графика ген. уборок. */
export type SanitationDirectoryRoom = { id: string; name: string };

export type SanitationDayConfig = {
  year: number;
  documentDate: string;
  approveRole: string;
  approveEmployeeId?: string | null;
  approveEmployee: string;
  responsibleRole: string;
  responsibleEmployeeId?: string | null;
  responsibleEmployee: string;
  rows: SanitationRoomRow[];
};

function createMonthValues(fill = "-"): SanitationMonthValues {
  return {
    jan: fill,
    feb: fill,
    mar: fill,
    apr: fill,
    may: fill,
    jun: fill,
    jul: fill,
    aug: fill,
    sep: fill,
    oct: fill,
    nov: fill,
    dec: fill,
  };
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function safeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function safeYear(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function normalizeMonthCell(value: unknown) {
  return safeText(value).trim() || "-";
}

function normalizeMonthValues(value: unknown) {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    jan: normalizeMonthCell(source.jan),
    feb: normalizeMonthCell(source.feb),
    mar: normalizeMonthCell(source.mar),
    apr: normalizeMonthCell(source.apr),
    may: normalizeMonthCell(source.may),
    jun: normalizeMonthCell(source.jun),
    jul: normalizeMonthCell(source.jul),
    aug: normalizeMonthCell(source.aug),
    sep: normalizeMonthCell(source.sep),
    oct: normalizeMonthCell(source.oct),
    nov: normalizeMonthCell(source.nov),
    dec: normalizeMonthCell(source.dec),
  };
}

function normalizeRows(value: unknown): SanitationRoomRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row, index) => {
      if (!row || typeof row !== "object") return null;
      const source = row as Record<string, unknown>;
      const roomId =
        typeof source.roomId === "string" && source.roomId.length > 0
          ? source.roomId
          : undefined;
      return {
        id:
          typeof source.id === "string" && source.id.length > 0
            ? source.id
            : `row-${index + 1}`,
        ...(roomId ? { roomId } : {}),
        roomName: safeText(source.roomName),
        plan: normalizeMonthValues(source.plan),
        fact: normalizeMonthValues(source.fact),
      };
    })
    .filter((item): item is SanitationRoomRow => item !== null);
}

/** Стабильный id строки для помещения справочника. */
export function sanitationRowIdForRoom(roomId: string): string {
  return `row-room-${roomId}`;
}

/**
 * Строит конфиг графика ген. уборок из помещений справочника (Room,
 * /settings/buildings). Пусто — stub-дефолт.
 */
export function buildSanitationDayConfigFromRooms(
  rooms: ReadonlyArray<SanitationDirectoryRoom>,
  date = new Date(),
): SanitationDayConfig {
  if (rooms.length === 0) {
    return getSanitationDayDefaultConfig(date);
  }
  const base = buildSanitationDayConfigFromAreas([], date);
  return {
    ...base,
    rows: rooms.map((room) => ({
      id: sanitationRowIdForRoom(room.id),
      roomId: room.id,
      roomName: room.name,
      plan: createMonthValues("-"),
      fact: createMonthValues("-"),
    })),
  };
}

/**
 * Эффективный конфиг: у строк с `roomId` название берётся из справочника
 * (Room wins), если помещение живо. Только для отображения — в документ
 * пишется raw-конфиг.
 */
export function applyRoomDirectoryToSanitationConfig(
  config: SanitationDayConfig,
  rooms: ReadonlyArray<SanitationDirectoryRoom>,
): SanitationDayConfig {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  return {
    ...config,
    rows: config.rows.map((row) => {
      if (!row.roomId) return row;
      const dbRoom = byId.get(row.roomId);
      if (!dbRoom) return row;
      return { ...row, roomName: dbRoom.name.trim() || row.roomName };
    }),
  };
}

/** Помещения справочника, которых ещё нет в графике. */
export function listSanitationRoomsNotInDocument(
  config: Pick<SanitationDayConfig, "rows">,
  rooms: ReadonlyArray<SanitationDirectoryRoom>,
): SanitationDirectoryRoom[] {
  const linked = new Set(config.rows.map((r) => r.roomId).filter(Boolean));
  return rooms.filter((r) => !linked.has(r.id));
}

/** Подсказка «Связать» для legacy-строки: помещение с тем же названием. */
export function suggestDirectoryRoomForSanitationRow(
  row: Pick<SanitationRoomRow, "roomName" | "roomId">,
  rooms: ReadonlyArray<SanitationDirectoryRoom>,
): SanitationDirectoryRoom | null {
  if (row.roomId) return null;
  const needle = row.roomName.trim().toLowerCase();
  if (!needle) return null;
  return rooms.find((r) => r.name.trim().toLowerCase() === needle) ?? null;
}

/**
 * Строит конфиг санитарного дня из списка цехов/помещений (Area).
 * Каждый цех становится строкой таблицы с пустыми planned/fact
 * месяцами — заведующая потом проставит даты по графику.
 *
 * Если areas пустой — возвращает stub-дефолт с двумя примерами.
 */
export function buildSanitationDayConfigFromAreas(
  areas: Array<{ id: string; name: string }>,
  date = new Date(),
): SanitationDayConfig {
  if (areas.length === 0) {
    return getSanitationDayDefaultConfig(date);
  }

  const year = date.getUTCFullYear();
  const d = new Date(Date.UTC(year, 0, 1));

  return {
    year,
    documentDate: toDateKey(d),
    approveRole: "Управляющий",
    approveEmployeeId: null,
    approveEmployee: "",
    responsibleRole: "Управляющий",
    responsibleEmployeeId: null,
    responsibleEmployee: "",
    rows: areas.map((area, index) => ({
      id: `row-area-${area.id || `idx-${index}`}`,
      roomName: area.name,
      plan: createMonthValues("-"),
      fact: createMonthValues("-"),
    })),
  };
}

export function getSanitationDayDefaultConfig(
  date = new Date(),
): SanitationDayConfig {
  const year = date.getUTCFullYear();
  const d = new Date(Date.UTC(year, 0, 1));

  return {
    year,
    documentDate: toDateKey(d),
    approveRole: "Управляющий",
    approveEmployeeId: null,
    approveEmployee: "",
    responsibleRole: "Управляющий",
    responsibleEmployeeId: null,
    responsibleEmployee: "",
    rows: [
      {
        id: "row-1",
        roomName: "Производство 1 этаж",
        plan: {
          ...createMonthValues("10"),
          jun: "-",
          apr: "10, 17, 24",
        },
        fact: {
          ...createMonthValues("10"),
          feb: "01",
          apr: "01",
          jun: "-",
        },
      },
      {
        id: "row-2",
        roomName: "сухой склад",
        plan: {
          ...createMonthValues("-"),
          apr: "14",
        },
        fact: {
          ...createMonthValues("-"),
          apr: "14",
        },
      },
    ],
  };
}

export function normalizeSanitationDayConfig(
  config: unknown,
): SanitationDayConfig {
  const fallback = getSanitationDayDefaultConfig();
  if (!config || typeof config !== "object" || Array.isArray(config))
    return fallback;
  const source = config as Record<string, unknown>;

  return {
    year: safeYear(source.year, fallback.year),
    documentDate: safeText(source.documentDate) || fallback.documentDate,
    approveRole: safeText(source.approveRole) || fallback.approveRole,
    approveEmployeeId:
      safeText(source.approveEmployeeId) || fallback.approveEmployeeId || null,
    approveEmployee:
      safeText(source.approveEmployee) || fallback.approveEmployee,
    responsibleRole:
      safeText(source.responsibleRole) || fallback.responsibleRole,
    responsibleEmployeeId:
      safeText(source.responsibleEmployeeId) ||
      fallback.responsibleEmployeeId ||
      null,
    responsibleEmployee:
      safeText(source.responsibleEmployee) || fallback.responsibleEmployee,
    rows: normalizeRows(source.rows),
  };
}

export function getSanitationYearLabel(year: number) {
  return String(year);
}

export function getSanitationDocumentDateLabel(dateKey: string) {
  if (!dateKey) return "—";
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  return `${day}-${month}-${year}`;
}

/**
 * «Должность + сотрудник» одной строкой.
 *
 * G3 аудита: в служебной строке бланка эталон разделяет их ЗАПЯТОЙ
 * («Заведующий, Иванова Анна Петровна»), а не двоеточием. В карточках
 * списка документов двоеточие осталось — там это подпись «должность:
 * сотрудник», поэтому разделитель параметризован.
 */
export function getSanitationApproveLabel(
  role: string,
  employee: string,
  separator = ": ",
) {
  // Разделитель — только между двумя непустыми частями: без сотрудника
  // здесь печаталось «Управляющий:» с пустотой после двоеточия.
  return formatPositionWithName(role, employee, { separator });
}

export function createEmptySanitationRow(
  name = "",
  roomId?: string,
): SanitationRoomRow {
  return {
    id: roomId
      ? sanitationRowIdForRoom(roomId)
      : `row-${Math.random().toString(36).slice(2, 9)}`,
    ...(roomId ? { roomId } : {}),
    roomName: name,
    plan: createMonthValues("-"),
    fact: createMonthValues("-"),
  };
}
