import { isManagementRole } from "@/lib/user-roles";

/**
 * «Кто заполняет» объект по QR (холодильник, склад, помещение, УФ-лампа)
 * — 2026-09-22. Пустой список — все сотрудники. Иначе — только закреплённые;
 * чужой сотрудник не пройдёт даже с верным PIN. Руководство и сотрудники с
 * «Разрешением менять настройки» заполняют любой объект.
 */
export type FillerCandidate = { id: string; role?: string | null; canManageSettings?: boolean | null };

export function canFillObject(fillerUserIds: readonly string[] | null | undefined, employee: FillerCandidate): boolean {
  if (!fillerUserIds || fillerUserIds.length === 0) return true;
  if (fillerUserIds.includes(employee.id)) return true;
  return isManagementRole(employee.role ?? "") || employee.canManageSettings === true;
}

export function filterAllowedFillers<T extends FillerCandidate>(employees: readonly T[], fillerUserIds: readonly string[] | null | undefined): T[] {
  return employees.filter((employee) => canFillObject(fillerUserIds, employee));
}

export const OBJECT_FILLER_DENIED = "Этот объект закреплён за другими сотрудниками — заполнить его может только закреплённый сотрудник или руководитель.";
