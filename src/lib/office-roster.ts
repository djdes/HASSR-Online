import { isManagementRole } from "@/lib/user-roles";

/** Человек для блока «Руководство» страницы «Офис». */
export type OfficeRosterPerson = {
  role: string | null;
  buildingIds: readonly string[];
  jobPosition?: { categoryKey?: string | null } | null;
};

/**
 * «Руководство» на странице «Офис» (владелец, 2026-11-23: «отображаем
 * сотрудника, директора, руководителя — тех, кто меняет журналы и т. д.»):
 * люди, закреплённые за офисом, и руководство всей компании — роль или
 * должность руководства без закрепления за объектами. Руководитель объекта
 * (закреплён за объектами) — на странице своего объекта. `knownBuildingIds` —
 * здания организации: висящие id удалённых объектов не считаются.
 */
export function isOfficeLeader(
  person: OfficeRosterPerson,
  officeId: string | null,
  knownBuildingIds: readonly string[],
): boolean {
  if (officeId && person.buildingIds.includes(officeId)) return true;
  const management = isManagementRole(person.role) || person.jobPosition?.categoryKey === "management";
  if (!management) return false;
  return !person.buildingIds.some((id) => knownBuildingIds.includes(id));
}
