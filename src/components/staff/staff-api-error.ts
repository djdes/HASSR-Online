export type StaffApiErrorKey =
  | "managerOnly"
  | "employeeNotFound"
  | "positionNotFound"
  | "recordNotFound"
  | "endBeforeStart"
  | "invalidDate"
  | "rootCannotArchive"
  | "cannotArchiveSelf";

const KNOWN_ERRORS: Record<string, StaffApiErrorKey> = {
  "Это действие доступно руководителю": "managerOnly",
  "Сотрудник не найден": "employeeNotFound",
  "Должность не найдена": "positionNotFound",
  "Должность не найдена в этой организации": "positionNotFound",
  "Запись не найдена": "recordNotFound",
  "Дата окончания раньше даты начала": "endBeforeStart",
  "Некорректная дата": "invalidDate",
  "Некорректная дата увольнения": "invalidDate",
  "Некорректная дата периода": "invalidDate",
  "ROOT-учётную запись нельзя архивировать": "rootCannotArchive",
  "Нельзя архивировать самого себя": "cannotArchiveSelf",
};

export function staffApiErrorKey(message: string | undefined): StaffApiErrorKey | null {
  return message ? KNOWN_ERRORS[message] ?? null : null;
}
