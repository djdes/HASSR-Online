/**
 * Меню профиля: «Организации» и «Кабинет».
 *
 * Мастер-кабинет справочников (организация `kind="directory"`) — не
 * точка, где ведут журналы, а отдельный кабинет бэк-офиса со своей
 * оболочкой `/master`. Поэтому в меню профиля (лист на телефоне,
 * выпадающее меню на компьютере) и в переключателе мини-приложения он
 * стоит не в списке «Организации», а в разделе «Кабинет» — рядом с «Моя
 * организация» и «Партнёрский кабинет» (решение владельца 2026-09-26).
 */

export type CabinetMenuOrganization = { id: string; kind?: string | null };

/** Разделить список: обычные организации — в «Организации», мастер-кабинеты — в «Кабинет». */
export function splitCabinetMenu<T extends CabinetMenuOrganization>(
  organizations: readonly T[],
): { organizations: T[]; masterCabinets: T[] } {
  const regular: T[] = [];
  const masterCabinets: T[] = [];
  for (const organization of organizations) {
    if (organization.kind === "directory") masterCabinets.push(organization);
    else regular.push(organization);
  }
  return { organizations: regular, masterCabinets };
}

/** Куда ведёт строка мастер-кабинета: его собственная оболочка. */
export const MASTER_CABINET_HREF = "/master";
