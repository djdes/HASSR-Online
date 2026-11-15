export const TRAINING_PLAN_TEMPLATE_CODE = "training_plan";
export const TRAINING_PLAN_SOURCE_SLUG = "edujournal";

export const TRAINING_PLAN_HEADING = "План обучения персонала";
export const TRAINING_PLAN_DOCUMENT_TITLE = "План обучения";

export type TrainingCell = {
  required: boolean;
  date: string; // MM.YY format, for example "01.25"
};

export type TrainingPositionRow = {
  id: string;
  positionName: string;
  cells: Record<string, TrainingCell>;
};

export type TrainingPlanConfig = {
  year: number;
  documentDate: string;
  approveRole: string;
  approveEmployeeId?: string | null;
  approveEmployee: string;
  topics: { id: string; name: string }[];
  rows: TrainingPositionRow[];
};

function createId() {
  return `tp-${Math.random().toString(36).slice(2, 9)}`;
}

function formatYearSuffix(year: number) {
  return String(year).slice(-2);
}

function buildDefaultRows(year: number): TrainingPositionRow[] {
  const yy = formatYearSuffix(year);

  return [
    {
      id: "row-1",
      positionName: "Шеф-повар",
      cells: {
        kkt: { required: true, date: `01.${yy}` },
        sanitation: { required: true, date: `10.${yy}` },
        duties: { required: false, date: "" },
        safety: { required: false, date: "" },
        fire: { required: false, date: "" },
      },
    },
    {
      id: "row-2",
      positionName: "Сотрудник",
      cells: {
        kkt: { required: true, date: `02.${yy}` },
        sanitation: { required: false, date: "" },
        duties: { required: false, date: "" },
        safety: { required: true, date: `01.${yy}` },
        fire: { required: false, date: "" },
      },
    },
    {
      id: "row-3",
      positionName: "Официант",
      cells: {
        kkt: { required: true, date: `01.${yy}` },
        sanitation: { required: false, date: "" },
        duties: { required: false, date: "" },
        safety: { required: true, date: `01.${yy}` },
        fire: { required: false, date: "" },
      },
    },
  ];
}

export function createTrainingTopic(name: string) {
  return {
    id: createId(),
    name,
  };
}

function safeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function safeYear(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeCell(value: unknown): TrainingCell {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { required: false, date: "" };
  }
  const source = value as Record<string, unknown>;
  return {
    required: source.required === true,
    date: safeText(source.date),
  };
}

function normalizeTopics(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const id = safeText(source.id);
      const name = safeText(source.name);
      if (!id || !name) return null;
      return { id, name };
    })
    .filter((item): item is { id: string; name: string } => item !== null);
}

function normalizeRows(value: unknown, topicIds: string[]): TrainingPositionRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const source = row as Record<string, unknown>;
      const id =
        typeof source.id === "string" && source.id.length > 0
          ? source.id
          : `row-${index + 1}`;
      const positionName = safeText(source.positionName);
      const rawCells =
        source.cells && typeof source.cells === "object" && !Array.isArray(source.cells)
          ? (source.cells as Record<string, unknown>)
          : {};
      const cells: Record<string, TrainingCell> = {};
      for (const topicId of topicIds) {
        cells[topicId] = normalizeCell(rawCells[topicId]);
      }
      return { id, positionName, cells };
    })
    .filter((item): item is TrainingPositionRow => item !== null);
}

const DEFAULT_TOPICS = [
  { id: "kkt", name: "ККТ" },
  { id: "sanitation", name: "Санитария и гигиена" },
  { id: "duties", name: "Должностные обязанности" },
  { id: "safety", name: "Охрана труда" },
  { id: "fire", name: "Пожарная безопасность" },
];

export function getTrainingPlanDefaultConfig(date = new Date()): TrainingPlanConfig {
  const year = date.getUTCFullYear();
  const documentDate = new Date(Date.UTC(year, 0, 11));

  return {
    year,
    documentDate: toDateKey(documentDate),
    approveRole: "Управляющий",
    approveEmployeeId: null,
    approveEmployee: "",
    topics: DEFAULT_TOPICS,
    rows: buildDefaultRows(year),
  };
}

export function normalizeTrainingPlanConfig(config: unknown): TrainingPlanConfig {
  const fallback = getTrainingPlanDefaultConfig();
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return fallback;
  }

  const source = config as Record<string, unknown>;
  const year = safeYear(source.year, fallback.year);
  const dateKey = safeText(source.documentDate) || fallback.documentDate;
  const topics = normalizeTopics(source.topics);
  const normalizedTopics = topics.length > 0 ? topics : fallback.topics;
  const topicIds = normalizedTopics.map((topic) => topic.id);
  const rows = normalizeRows(source.rows, topicIds);

  return {
    year,
    documentDate: dateKey,
    approveRole: safeText(source.approveRole) || fallback.approveRole,
    approveEmployeeId: safeText(source.approveEmployeeId) || fallback.approveEmployeeId || null,
    approveEmployee: safeText(source.approveEmployee) || fallback.approveEmployee,
    topics: normalizedTopics,
    rows: rows.length > 0 ? rows : buildDefaultRows(year),
  };
}

export function getTrainingPlanYearLabel(year: number) {
  return String(year);
}

export function getTrainingPlanDocumentDateLabel(dateKey: string) {
  if (!dateKey) return "—";
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  return `${day}-${month}-${year}`;
}

export function getTrainingPlanApproveLabel(role: string, employee: string) {
  const rolePart = role ? `${role}: ` : "";
  return `${rolePart}${employee || ""}`.trim();
}

export function createEmptyTrainingRow(name: string, topicIds: string[]): TrainingPositionRow {
  const cells: Record<string, TrainingCell> = {};
  for (const id of topicIds) {
    cells[id] = { required: false, date: "" };
  }
  return {
    id: createId(),
    positionName: name,
    cells,
  };
}
