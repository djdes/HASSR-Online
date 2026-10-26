import type { PrismaClient } from "@prisma/client";

/**
 * Настройки журналов точки поверх организации (2026-10-26).
 *
 * Когда организации сливаются в точки одной (`OrganizationMerge`), у каждой
 * точки остаются своя автоматика журналов и свой набор выключенных
 * журналов — они лежат в `Building` под теми же именами, что в
 * `Organization`. `null` в точке — «как у организации». Бракеражная
 * комиссия точки — в brakerage-commission-org.ts.
 */

export type BuildingJournalSettings = {
  autoJournalCodes: unknown;
  journalAutomationJson: unknown;
  disabledJournalCodes: unknown;
};

const SETTINGS_SELECT = { autoJournalCodes: true, journalAutomationJson: true, disabledJournalCodes: true } as const;

function hasOwnSettings(row: BuildingJournalSettings): boolean {
  return isSet(row.autoJournalCodes) || isSet(row.journalAutomationJson) || isSet(row.disabledJournalCodes);
}

type BuildingClient = Pick<PrismaClient, "building">;

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Организация с настройками точки поверх: заданное в точке заменяет организацию. */
export function withBuildingJournalSettings<T extends object>(
  org: T | null,
  building: Partial<BuildingJournalSettings> | null | undefined
): T | null {
  if (!org || !building) return org;
  const next: Record<string, unknown> = { ...(org as Record<string, unknown>) };
  if (isSet(building.autoJournalCodes)) next.autoJournalCodes = building.autoJournalCodes;
  if (isSet(building.journalAutomationJson)) next.journalAutomationJson = building.journalAutomationJson;
  if (isSet(building.disabledJournalCodes)) next.disabledJournalCodes = building.disabledJournalCodes;
  return next as T;
}

/** Настройки одной точки; нет точки или она ничего не задаёт — null. */
export async function readBuildingJournalSettings(
  client: BuildingClient,
  buildingId: string | null | undefined
): Promise<BuildingJournalSettings | null> {
  if (!buildingId) return null;
  const row = await client.building.findUnique({
    where: { id: buildingId },
    select: SETTINGS_SELECT,
  });
  if (!row || !hasOwnSettings(row)) return null;
  return row;
}

/** Настройки точек организации: id точки → её настройки (только заданные). */
export async function loadBuildingJournalSettings(
  client: BuildingClient,
  organizationId: string
): Promise<Map<string, BuildingJournalSettings>> {
  const rows = await client.building.findMany({
    where: { organizationId },
    select: { id: true, ...SETTINGS_SELECT },
  });
  return new Map(
    rows
      .filter(hasOwnSettings)
      .map(({ id, ...settings }) => [id, settings])
  );
}

/**
 * Сотрудник работает на точке: пустой `buildingIds` — на всех точках
 * (как `allowedBuildingsForUser`); без точки (`null`) — все сотрудники.
 */
export function worksAtBuilding(user: { buildingIds?: string[] | null }, buildingId: string | null | undefined): boolean {
  if (!buildingId) return true;
  const ids = user.buildingIds ?? [];
  return ids.length === 0 || ids.includes(buildingId);
}

/**
 * То же условие для `db.user.findMany`. Занимает верхний `OR` — не
 * смешивать с другим верхним `OR` в том же запросе.
 */
export function staffAtBuildingWhere(buildingId: string | null | undefined) {
  return buildingId
    ? { OR: [{ buildingIds: { isEmpty: true } }, { buildingIds: { has: buildingId } }] }
    : {};
}
