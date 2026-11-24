import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { openOrganizationOffice } from "@/lib/organization-office.server";

/**
 * Точки (2026-09-05): завести точки по числу из анкеты после регистрации.
 *
 * «Точек» = N ≥ 2 → в организации должно быть не меньше N зданий-точек:
 * недостающие создаются как «Точка k» (нумерация продолжает уже
 * существующие здания), первая созданная с нуля получает адрес
 * организации, и открывается офис (журналы по объектам). При N = 1 ничего не
 * происходит: одна точка — это обычная организация без переключателя.
 *
 * Идемпотентно: повторное сохранение анкеты с тем же числом ничего не
 * добавляет. Верхняя граница страхует от опечатки «500» — остальное
 * заводят руками на /settings/buildings.
 */
export const MAX_AUTO_LOCATIONS = 50;

export async function ensureLocationBuildings(
  organizationId: string,
  locationsCount: number,
  options: { firstAddress?: string | null } = {},
): Promise<{ created: number; enabled: boolean }> {
  const target = Math.min(Math.max(Math.floor(locationsCount), 0), MAX_AUTO_LOCATIONS);
  if (target < 2) return { created: 0, enabled: false };

  // Точки — объекты: офис (с 2026-11-24 он у всех) точкой не считается.
  const existing = await db.building.findMany({
    where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true },
  });
  const taken = new Set(existing.map((building) => building.name.trim().toLowerCase()));
  let created = 0;
  let number = existing.length + 1;
  let sortOrder = existing.reduce((max, building) => Math.max(max, building.sortOrder), -1) + 1;

  while (existing.length + created < target) {
    const name = `Точка ${number}`;
    number += 1;
    if (taken.has(name.toLowerCase())) continue;
    await db.building.create({
      data: {
        organizationId,
        name,
        address:
          existing.length === 0 && created === 0
            ? options.firstAddress?.trim() || null
            : null,
        sortOrder,
      },
      select: { id: true },
    });
    taken.add(name.toLowerCase());
    sortOrder += 1;
    created += 1;
  }

  // Точек ≥ 2 — открывается офис: журналы по объектам (как раньше) и офис
  // компании (2026-11-24, офис у всех по умолчанию).
  await openOrganizationOffice(organizationId, { source: "registration-locations" });
  return { created, enabled: true };
}
