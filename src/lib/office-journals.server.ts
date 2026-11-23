import { db } from "@/lib/db";
import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import { officeJournalTarget } from "@/lib/office-journals";

/** Что сделано (или было бы сделано) с журналами одного офиса. */
export type OfficeJournalsMove = {
  organizationId: string;
  officeId: string;
  /** Объект, на который переходят документы; null — объектов нет, не трогали. */
  targetId: string | null;
  documents: number;
  paperDocuments: number;
};

/**
 * Журналы, созданные в офисе, — на объект (владелец, 2026-11-23: «если
 * журнал в офисе уже создан и там не указан объект, привязывать к
 * единственному созданному или первому по списку объекту»). Документы
 * электронных и бумажных журналов с `buildingId` офиса переходят на объект
 * `officeJournalTarget`; организации без объектов не трогаются. Каждый перенос
 * — в журнал действий организации. `dryRun` — только посчитать.
 */
export async function moveOfficeJournalsToPoints(options: { dryRun: boolean }): Promise<OfficeJournalsMove[]> {
  const offices = await db.building.findMany({
    where: { kind: OFFICE_BUILDING_KIND },
    select: { id: true, organizationId: true },
    orderBy: { organizationId: "asc" },
  });
  const moves: OfficeJournalsMove[] = [];
  for (const office of offices) {
    const where = { organizationId: office.organizationId, buildingId: office.id };
    const [documents, paperDocuments] = await Promise.all([
      db.journalDocument.count({ where }),
      db.paperJournalDocument.count({ where }),
    ]);
    if (documents === 0 && paperDocuments === 0) continue;
    const buildings = await db.building.findMany({
      where: { organizationId: office.organizationId },
      select: { id: true, kind: true, sortOrder: true, name: true },
    });
    const targetId = officeJournalTarget(buildings);
    moves.push({ organizationId: office.organizationId, officeId: office.id, targetId, documents, paperDocuments });
    if (options.dryRun || !targetId) continue;
    await db.$transaction([
      db.journalDocument.updateMany({ where, data: { buildingId: targetId } }),
      db.paperJournalDocument.updateMany({ where, data: { buildingId: targetId } }),
      db.auditLog.create({
        data: {
          organizationId: office.organizationId,
          userName: "WeSetup",
          action: "journals.office_to_point",
          entity: "building",
          entityId: targetId,
          details: { officeId: office.id, targetId, documents, paperDocuments },
        },
      }),
    ]);
  }
  return moves;
}
