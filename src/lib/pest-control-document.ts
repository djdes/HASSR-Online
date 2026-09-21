import type { ReactNode } from "react";
import { getUserDisplayTitle, getUserPositionLabel } from "@/lib/user-roles";

export const PEST_CONTROL_TEMPLATE_CODE = "pest_control" as const;
export const PEST_CONTROL_DOCUMENT_TITLE =
  "Журнал учета дезинфекции, дезинсекции и дератизации";
export const PEST_CONTROL_CLOSED_TITLE = PEST_CONTROL_DOCUMENT_TITLE;

export const PEST_CONTROL_PAGE_TITLE = PEST_CONTROL_DOCUMENT_TITLE;

export type PestControlDocumentStatus = "active" | "closed";

export type PestControlListDocument = {
  id: string;
  title: string;
  status: PestControlDocumentStatus;
  dateFrom: string;
};

export type PestControlUser = {
  id: string;
  name: string;
  role: string;
  // Должность из карточки (как в UserLike): варианты и подстановка — по ней.
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

export type PestControlEntryData = {
  performedDate: string;
  performedHour: string;
  performedMinute: string;
  timeSpecified: boolean;
  event: string;
  areaOrVolume: string;
  treatmentProduct: string;
  note: string;
  performedBy: string;
  acceptedRole: string;
  acceptedEmployeeId: string;
};

export type PestControlEntryRecord = {
  id: string;
  employeeId?: string;
  date: string;
  data: Record<string, unknown>;
};

export type PestControlEntryFormState = PestControlEntryData;

export type PestControlRoleOption = {
  value: string;
  label: string;
};

export type PestControlEmployeeOption = {
  id: string;
  name: string;
  role: string;
};

export type PestControlDocumentAction = {
  icon: ReactNode;
  label: string;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function safeBoolean(value: unknown) {
  return value === true;
}

export function getPestControlDocumentTitle() {
  return PEST_CONTROL_DOCUMENT_TITLE;
}

export function getPestControlClosedTitle() {
  return PEST_CONTROL_CLOSED_TITLE;
}

export function formatPestControlDate(date: string) {
  return formatPestControlDateDot(date);
}

export function formatPestControlDateTime(entry: PestControlEntryData) {
  const dateLabel = formatPestControlDateDot(entry.performedDate);
  const hasTime = entry.timeSpecified && entry.performedHour && entry.performedMinute;
  return {
    dateLabel,
    timeLabel: hasTime ? `${entry.performedHour}:${entry.performedMinute}` : "",
  };
}

export function formatPestControlDateIso(date: string) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}-${month}-${year}`;
}

export function formatPestControlDateDot(date: string) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}.${month}.${year}`;
}

export function formatPestControlRowDate(
  performedDate: string,
  performedHour: string,
  performedMinute: string,
  timeSpecified: boolean
) {
  const datePart = formatPestControlDateIso(performedDate);
  if (!timeSpecified || !performedHour || !performedMinute) {
    return datePart;
  }

  return `${datePart}\n${performedHour}:${performedMinute}`;
}

export function getPestControlRoleOptions(users: PestControlUser[]) {
  // Метки из справочника должностей — те же, по которым фильтруются
  // сотрудники (раньше лейблы ролей: «Кладовщик» не находился).
  const values = users.map((user) => getUserPositionLabel(user));
  return [...new Set(values)].map((value) => ({ value, label: value }));
}

export function getPestControlEmployeesForRole(
  users: PestControlUser[],
  roleLabel: string
) {
  return users.filter((user) => getUserPositionLabel(user) === roleLabel);
}

export function getPestControlUsersForRole(
  users: PestControlUser[],
  roleLabel: string
) {
  return getPestControlEmployeesForRole(users, roleLabel);
}

export function getPestControlDefaultRole(users: PestControlUser[]) {
  return getPestControlRoleOptions(users)[0]?.value || "Управляющий";
}

export function getPestControlDefaultEmployeeId(
  users: PestControlUser[],
  roleLabel: string
) {
  return getPestControlEmployeesForRole(users, roleLabel)[0]?.id || users[0]?.id || "";
}

export function createEmptyPestControlEntry(
  users: PestControlUser[],
  performedDate = new Date().toISOString().slice(0, 10)
): PestControlEntryFormState {
  const acceptedRole = getPestControlDefaultRole(users);
  return {
    performedDate,
    performedHour: "",
    performedMinute: "",
    timeSpecified: false,
    event: "",
    areaOrVolume: "",
    treatmentProduct: "",
    note: "",
    performedBy: "",
    acceptedRole,
    acceptedEmployeeId: getPestControlDefaultEmployeeId(users, acceptedRole),
  };
}

export function normalizePestControlEntryData(
  data: unknown,
  fallbackDate = new Date().toISOString().slice(0, 10),
  users: PestControlUser[] = [],
  fallbackEmployeeId = ""
): PestControlEntryFormState {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return createEmptyPestControlEntry(users, fallbackDate);
  }

  const source = data as Record<string, unknown>;
  const performedDate = safeString(source.performedDate) || fallbackDate;
  // padStart по ПУСТОЙ строке давал "00": запись, сохранённая без
  // времени, показывалась и печаталась как «00:00».
  const rawHour = safeString(source.performedHour);
  const rawMinute = safeString(source.performedMinute);
  const performedHour = rawHour ? rawHour.padStart(2, "0").slice(0, 2) : "";
  const performedMinute = rawMinute ? rawMinute.padStart(2, "0").slice(0, 2) : "";
  // Принявший известен (в т.ч. исполнитель TasksFlow) — его должность из
  // карточки. Первую роль организации подставляем только совсем пустой
  // записи: иначе под фамилией стояла чужая должность («Управляющий»).
  const knownEmployeeId = safeString(source.acceptedEmployeeId) || fallbackEmployeeId;
  const knownEmployee = users.find((user) => user.id === knownEmployeeId);
  const acceptedRole =
    safeString(source.acceptedRole) ||
    (knownEmployee
      ? getUserDisplayTitle(knownEmployee)
      : knownEmployeeId
        ? ""
        : getPestControlDefaultRole(users));
  const acceptedEmployeeId =
    knownEmployeeId || getPestControlDefaultEmployeeId(users, acceptedRole);
  const timeSpecified = safeBoolean(source.timeSpecified) || !!(performedHour && performedMinute);

  return {
    performedDate,
    performedHour: timeSpecified ? performedHour : "",
    performedMinute: timeSpecified ? performedMinute : "",
    timeSpecified,
    event: safeString(source.event),
    areaOrVolume: safeString(source.areaOrVolume),
    treatmentProduct: safeString(source.treatmentProduct),
    note: safeString(source.note),
    performedBy: safeString(source.performedBy),
    acceptedRole,
    acceptedEmployeeId,
  };
}

export function isPestControlDocumentFields(
  fields: Array<{ key?: string; label?: string }> | undefined | null
) {
  if (!Array.isArray(fields)) return false;
  const keys = new Set(fields.map((field) => field.key).filter(Boolean));
  return (
    keys.has("performedDate") &&
    keys.has("event") &&
    keys.has("areaOrVolume") &&
    keys.has("treatmentProduct") &&
    keys.has("performedBy") &&
    keys.has("acceptedRole") &&
    keys.has("acceptedEmployeeId")
  );
}

export function buildPestControlRequestBody(
  entry: PestControlEntryFormState,
  acceptedEmployeeId: string
) {
  const hasTime = entry.timeSpecified && entry.performedHour && entry.performedMinute;
  return {
    performedDate: entry.performedDate,
    performedHour: hasTime ? entry.performedHour : "",
    performedMinute: hasTime ? entry.performedMinute : "",
    timeSpecified: hasTime,
    event: entry.event.trim(),
    areaOrVolume: entry.areaOrVolume.trim(),
    treatmentProduct: entry.treatmentProduct.trim(),
    note: entry.note.trim(),
    performedBy: entry.performedBy.trim(),
    acceptedRole: entry.acceptedRole.trim(),
    acceptedEmployeeId,
  };
}
