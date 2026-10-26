import { db } from "@/lib/db";
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

/**
 * Write back the set. Wipes whatever was there — caller is responsible
 * for sending the full desired list. Returns the normalized array that
 * was stored (dedup + strings only), useful for echoing back to the UI.
 */
export async function setDisabledJournalCodes(
  organizationId: string,
  codes: string[],
  buildingId?: string | null
): Promise<string[]> {
  const normalized = [...new Set(codes.filter((c) => typeof c === "string" && c.length > 0))];
  // Точка со своим набором: пишем в неё. Журнал, включённый на точке,
  // включается и у организации — иначе его страница ответила бы
  // «журнал отключён» (у организации выключено только то, что выключено
  // на всех точках).
  if ((await ownBuildingDisabledCodes(organizationId, buildingId)) !== null && buildingId) {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { disabledJournalCodes: true },
    });
    const keep = new Set(normalized);
    await db.$transaction([
      db.building.update({ where: { id: buildingId }, data: { disabledJournalCodes: normalized } }),
      db.organization.update({
        where: { id: organizationId },
        data: { disabledJournalCodes: [...parseDisabledCodes(org?.disabledJournalCodes)].filter((code) => keep.has(code)) },
      }),
    ]);
    return normalized;
  }
  await db.organization.update({
    where: { id: organizationId },
    data: { disabledJournalCodes: normalized },
  });
  return normalized;
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
  buildingId?: string | null
): Promise<string[]> {
  const known = new Set(PAPER_JOURNALS.map((journal) => journal.id));
  const normalized = [...new Set(ids.filter((id) => known.has(id)))];
  if (buildingId) {
    const building = await db.building.findFirst({
      where: { id: buildingId, organizationId },
      select: { disabledPaperJournalIds: true },
    });
    if (building && building.disabledPaperJournalIds !== null) {
      await db.building.update({ where: { id: buildingId }, data: { disabledPaperJournalIds: normalized } });
      return normalized;
    }
  }
  await db.organization.update({
    where: { id: organizationId },
    data: { disabledPaperJournalIds: normalized },
  });
  return normalized;
}
