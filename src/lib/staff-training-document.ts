import { getUserDisplayTitle, normalizeUserRole } from "@/lib/user-roles";

export const STAFF_TRAINING_TEMPLATE_CODE = "staff_training";
export const STAFF_TRAINING_DOCUMENT_TITLE = "Журнал регистрации инструктажей";
export const STAFF_TRAINING_FULL_TITLE =
  "Журнал регистрации инструктажей (обучения) сотрудников";

export const TRAINING_TYPES = [
  { value: "primary", label: "Первичный" },
  { value: "repeated", label: "Повторный" },
  { value: "unscheduled", label: "Внеплановый" },
] as const;

export const TRAINING_TOPICS = [
  { value: "safety", label: "Охрана труда" },
  { value: "duties", label: "Должностные обязанности" },
  { value: "kkt", label: "ККТ" },
  { value: "sanitation", label: "Санитария и гигиена" },
  { value: "fire", label: "Пожарная безопасность" },
] as const;

export const ATTESTATION_RESULTS = [
  { value: "passed", label: "удовл." },
  { value: "failed", label: "не удовл." },
] as const;

export type StaffTrainingRow = {
  id: string;
  date: string;
  employeeId?: string | null;
  employeeName: string;
  employeePosition: string;
  topic: string;
  trainingType: string;
  unscheduledReason: string;
  instructorName: string;
  attestationResult: "passed" | "failed" | "";
};

export type StaffTrainingConfig = {
  rows: StaffTrainingRow[];
  showSignatureField: boolean;
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

export function createStaffTrainingRow(
  overrides: Partial<StaffTrainingRow> = {}
): StaffTrainingRow {
  return {
    id: overrides.id || createId("training-row"),
    date: normalizeText(overrides.date),
    employeeId: normalizeText(overrides.employeeId) || null,
    employeeName: normalizeText(overrides.employeeName),
    employeePosition: normalizeText(overrides.employeePosition),
    topic: normalizeText(overrides.topic),
    trainingType: normalizeText(overrides.trainingType),
    unscheduledReason: normalizeText(overrides.unscheduledReason),
    instructorName: normalizeText(overrides.instructorName),
    attestationResult:
      overrides.attestationResult === "passed" || overrides.attestationResult === "failed"
        ? overrides.attestationResult
        : "",
  };
}

export function getDefaultStaffTrainingConfig(): StaffTrainingConfig {
  return {
    rows: [],
    showSignatureField: false,
  };
}

export function buildStaffTrainingSeedRows(
  users: Array<{
    name: string;
    role: string;
    positionTitle?: string | null;
    jobPosition?: { name?: string | null } | null;
  }>,
  dateKey: string
): StaffTrainingRow[] {
  const rows: StaffTrainingRow[] = [];
  const topics = ["Охрана труда", "Должностные обязанности", "ККТ"];

  for (const user of users.slice(0, 5)) {
    if (normalizeUserRole(user.role) === "manager") continue;
    for (const topic of topics) {
      rows.push(
        createStaffTrainingRow({
          date: dateKey,
          employeeId: null,
          employeeName: user.name,
          // Должность из справочника, а не лейбл роли.
          employeePosition: getUserDisplayTitle(user),
          topic,
          trainingType: "",
          unscheduledReason: "",
          instructorName: "",
          attestationResult: "",
        })
      );
    }
  }

  return rows;
}

export function normalizeStaffTrainingConfig(
  value: unknown
): StaffTrainingConfig {
  const defaults = getDefaultStaffTrainingConfig();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          return createStaffTrainingRow(item as Partial<StaffTrainingRow>);
        })
        .filter((item): item is StaffTrainingRow => item !== null)
    : [];

  return {
    rows,
    showSignatureField: record.showSignatureField === true,
  };
}

export function getStaffTrainingCreatePeriodBounds(referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}
