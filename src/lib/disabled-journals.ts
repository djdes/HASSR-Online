import { db } from "@/lib/db";
import { disabledAfter, planJournalSetWrite } from "@/lib/point-journals";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

/**
 * Свой набор выключенных журналов точки (слитая организация,
 * `Building.disabledJournalCodes`); у точки без своего набора — null.
 */
async function ownBuildingDisabledCodes(organizationId: string, buildingId: string | null | undefined): Promise<unknown> {
  if (!buildingId) return null;
  const building = await db.building.findFirst({
    where: { id: buildingId, organizationId },
    select: { disabledJournalCodes: true },
  });
  return building?.disabledJournalCodes ?? null;
}

/**
 * Returns the set of journal template codes the organization has toggled
 * off in /settings/journals. Empty set = every journal is enabled
 * (default for newly-registered orgs). С точкой, у которой свой набор, —
 * набор точки.
 */
export async function getDisabledJournalCodes(
  organizationId: string,
  buildingId?: string | null
): Promise<Set<string>> {
  const own = await ownBuildingDisabledCodes(organizationId, buildingId);
  if (own !== null) return parseDisabledCodes(own);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { disabledJournalCodes: true },
  });
  return parseDisabledCodes(org?.disabledJournalCodes);
}

/**
 * Pure parser — use when the caller already loaded the organization
 * row (e.g. the dashboard, which selects many fields at once).
 */
export function parseDisabledCodes(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  for (const value of raw) {
    if (typeof value === "string" && value.length > 0) out.add(value);
  }
  return out;
}

type JournalSetField = "disabledJournalCodes" | "disabledPaperJournalIds";

function journalSetData(field: JournalSetField, value: string[]) {
  return field === "disabledJournalCodes" ? { disabledJournalCodes: value } : { disabledPaperJournalIds: value };
}

/**
 * Записать полный набор (`planJournalSetWrite`, 2026-11-01). `pointId` —
 * точка из шапки (`viewedPointId`): правится только её набор, остальные
 * точки сохраняют свой. null — вся организация: изменения расходятся на
 * организацию и на все точки со своим набором. Возвращает набор, который
 * теперь видит выбранное место.
 */
async function writeJournalSet(
  organizationId: string,
  field: JournalSetField,
  codes: string[],
  pointId: string | null,
): Promise<string[]> {
  const [organization, buildings] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { disabledJournalCodes: true, disabledPaperJournalIds: true },
    }),
    db.building.findMany({
      where: { organizationId },
      select: { id: true, disabledJournalCodes: true, disabledPaperJournalIds: true },
    }),
  ]);
  const sets = {
    orgDisabled: [...parseDisabledCodes(organization?.[field])],
    buildings: buildings.map((building) => ({
      id: building.id,
      disabled: building[field] === null ? null : [...parseDisabledCodes(building[field])],
    })),
  };
  const target = pointId && sets.buildings.some((building) => building.id === pointId) ? pointId : null;
  const plan = planJournalSetWrite(sets, target, codes);
  await db.$transaction([
    db.organization.update({ where: { id: organizationId }, data: journalSetData(field, plan.orgDisabled) }),
    ...plan.buildings.map((building) =>
      db.building.update({ where: { id: building.id }, data: journalSetData(field, building.disabled) }),
    ),
  ]);
  return disabledAfter(plan, sets, target);
}

/**
 * Write back the set. Wipes whatever was there — caller is responsible
 * for sending the full desired list. Returns the normalized array that
 * was stored (dedup + strings only), useful for echoing back to the UI.
 *
 * `pointId` — точка из шапки (`viewedPointId`), null — вся организация
 * (см. `writeJournalSet`). Журнал, включённый на точке, включается и у
 * организации — у организации выключено только то, что выключено на всех
 * точках.
 */
export async function setDisabledJournalCodes(
  organizationId: string,
  codes: string[],
  pointId?: string | null
): Promise<string[]> {
  const normalized = [...new Set(codes.filter((c) => typeof c === "string" && c.length > 0))];
  return writeJournalSet(organizationId, "disabledJournalCodes", normalized, pointId ?? null);
}

/**
 * Бумажные бланки, которые организация скрыла в /settings/journals.
 *
 * Отдельное поле, а не общий disabledJournalCodes: бумажный журнал —
 * не JournalTemplate, а константа из PAPER_JOURNALS, и его id живёт в
 * своём пространстве имён (коды могут совпасть с электронными).
 */
export async function getDisabledPaperJournalIds(
  organizationId: string,
  buildingId?: string | null
): Promise<Set<string>> {
  // Точка со своим списком (слитая организация) — её список.
  if (buildingId) {
    const building = await db.building.findFirst({
      where: { id: buildingId, organizationId },
      select: { disabledPaperJournalIds: true },
    });
    if (building && building.disabledPaperJournalIds !== null) {
      return parseDisabledCodes(building.disabledPaperJournalIds);
    }
  }
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { disabledPaperJournalIds: true },
  });
  return parseDisabledCodes(org?.disabledPaperJournalIds);
}

/**
 * Пишет полный список скрытых бланков. Чужие строки отбрасываем —
 * в поле должны лежать только id из каталога, иначе оно со временем
 * зарастает мусором от старых версий UI.
 */
export async function setDisabledPaperJournalIds(
  organizationId: string,
  ids: string[],
  pointId?: string | null
): Promise<string[]> {
  const known = new Set(PAPER_JOURNALS.map((journal) => journal.id));
  const normalized = [...new Set(ids.filter((id) => known.has(id)))];
  return writeJournalSet(organizationId, "disabledPaperJournalIds", normalized, pointId ?? null);
}
