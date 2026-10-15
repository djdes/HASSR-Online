import type { Locale } from "@/i18n/locales";
import { formatDate } from "@/i18n/locales";
import { presentDocumentTitle } from "@/i18n/journal-document-presentation";
import { EQUIPMENT_CALIBRATION_DOCUMENT_TITLE, formatCalibrationDate, formatCalibrationDateLong } from "@/lib/equipment-calibration-document";
import { USER_ROLE_LABELS, type UserRole } from "@/lib/user-roles";
import type { PersonDisplayUser } from "@/lib/approver-display";
import { isFetchNetworkError } from "@/lib/humanize-fetch-error";

export function calibrationDate(value: string, locale: Locale, long = false) {
  if (!value) return "";
  if (locale === "ru") return long ? formatCalibrationDateLong(value) : formatCalibrationDate(value);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return formatDate(locale, date, "UTC", { day: "2-digit", month: long ? "long" : "2-digit", year: "numeric" });
}

/** Only canonical role fallbacks are translated. A customer-defined title wins. */
export function calibrationPositionLabel(value: string, users: readonly Pick<PersonDisplayUser, "name" | "positionTitle" | "jobPosition">[], roles: Record<UserRole, string>) {
  if (users.some(user => user.jobPosition?.name?.trim() === value || user.positionTitle?.trim() === value)) return value;
  const role = (Object.keys(USER_ROLE_LABELS) as UserRole[]).find(key => USER_ROLE_LABELS[key] === value);
  return role ? roles[role] : value;
}

export function calibrationDocumentTitle(title: string, year: number, locale: Locale, localizedName: string, formatTitle: (name: string, period: string) => string) {
  return presentDocumentTitle({ title, templateCode: "equipment_calibration", sourceNames: [EQUIPMENT_CALIBRATION_DOCUMENT_TITLE], localizedName, dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`, locale, formatTitle });
}

export type CalibrationErrorKey = "save" | "delete" | "status" | "copy" | "saveJournal" | "saveSettings" | "network" | "forbidden" | "unauthorized" | "notFound" | "closed" | "invalid";

class CalibrationRequestError extends Error {
  constructor(readonly key: CalibrationErrorKey) { super(key); }
}

export async function checkCalibrationResponse(response: Response, fallback: CalibrationErrorKey) {
  if (response.ok) return;
  const payload = await response.json().catch(() => null);
  throw new CalibrationRequestError(calibrationErrorKey(payload?.code || payload?.error, fallback, response.status));
}

/** API strings remain compatible on the wire; unknown server details use the action fallback. */
export function calibrationErrorKey(error: unknown, fallback: CalibrationErrorKey, status?: number): CalibrationErrorKey {
  if (error instanceof CalibrationRequestError) return error.key;
  if (isFetchNetworkError(error)) return "network";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (status === 401 || /^(UNAUTHORIZED|Unauthorized|Не авторизован|Необходима авторизация)$/.test(message)) return "unauthorized";
  if (status === 403 || /^(FORBIDDEN|Forbidden|Нет доступа|Нет доступа к журналу|Недостаточно прав)$/.test(message)) return "forbidden";
  if (status === 404 || /^(DOCUMENT_NOT_FOUND|Документ не найден)$/.test(message)) return "notFound";
  if (/^(DOCUMENT_CLOSED|Документ закрыт)/.test(message)) return "closed";
  if (status === 400 || /^(VALIDATION_ERROR|Некорректные данные)/.test(message)) return "invalid";
  return fallback;
}
