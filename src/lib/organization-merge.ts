import { db } from "@/lib/db";
import { JOURNAL_FILL_HUB_CODE, journalFillSubject, type JournalFillTokenCheck } from "@/lib/journal-fill";
import { mintQrFillToken } from "@/lib/qr-fill-token";

/**
 * Организации, слитые в точки другой (`OrganizationMerge`, 2026-10-26).
 *
 * Прежняя организация удалена, но её QR-плакаты и печатные журналы уже
 * висят на кухне: `/journal-fill/<старый id>/…` и `/qj/<старый id>/…`
 * подписаны старым id. По записи слияния они ведут в тот же журнал новой
 * организации — в документ, точку или, для основного QR, в точку, в
 * которую превратилась прежняя организация.
 */

export type MergedOrganization = { organizationId: string; buildingId: string | null };

export async function findMergedOrganization(oldOrganizationId: string): Promise<MergedOrganization | null> {
  const merge = await db.organizationMerge.findUnique({
    where: { oldOrganizationId },
    select: { organizationId: true, buildingId: true },
  });
  return merge ?? null;
}

/** Тот же QR в новой организации: путь `/journal-fill/<новый id>/<код>?token=…`. */
export function mergedJournalFillPath(
  check: Extract<JournalFillTokenCheck, { ok: true }>,
  code: string,
  merged: MergedOrganization
): string {
  // Хаб прежней организации — хаб её точки (2026-10-28): плакат висит там,
  // и журналы остальных точек новой организации ему не нужны.
  const subject = check.hub
    ? journalFillSubject(merged.organizationId, JOURNAL_FILL_HUB_CODE, null, { buildingId: check.buildingId ?? merged.buildingId })
    : journalFillSubject(merged.organizationId, code, check.documentId, {
        validUntil: check.validUntil,
        // Основной QR прежней организации — это QR её точки.
        buildingId: check.documentId ? null : (check.buildingId ?? merged.buildingId),
      });
  const target = check.hub ? JOURNAL_FILL_HUB_CODE : code;
  const token = mintQrFillToken("journal", subject);
  return `/journal-fill/${merged.organizationId}/${target}?token=${encodeURIComponent(token)}`;
}
