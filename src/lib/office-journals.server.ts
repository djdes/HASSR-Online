import { db } from "@/lib/db";
import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import { getDisabledJournalCodes, getDisabledPaperJournalIds } from "@/lib/disabled-journals";
import { planOfficeJournalMoves } from "@/lib/office-journals";

/** Счётчики по одному виду документов: перенесены, пропущены как дубли, журнал выключен на объекте. */
export type MoveCounts = { moved: number; overlap: number; disabled: number };

/** Что сделано (или было бы сделано) с журналами одного офиса. */
export type OfficeJournalsMove = {
  organizationId: string;
  officeId: string;
  /** Объект, на который переходят документы; null — объектов нет, не трогали. */
  targetId: string | null;
  documents: MoveCounts;
  paperDocuments: MoveCounts;
};

const counts = (plan: { move: string[]; overlap: string[]; disabled: string[] }): MoveCounts => ({
  moved: plan.move.length,
  overlap: plan.overlap.length,
  disabled: plan.disabled.length,
});

/**
 * Журналы, созданные в офисе, — на объект (владелец, 2026-11-23: «если
 * журнал в офисе уже создан и там не указан объект, привязывать к
 * единственному созданному или первому по списку объекту»). Объект — первый
 * в том же порядке, что в списках кабинета (`sortOrder`, название).
 * Переносятся только документы без пары на объекте (`planOfficeJournalMoves`):
 * копии, которые автоматика заводила и офису, и объекту за тот же период,
 * остаются на офисе — иначе на объекте было бы два документа одного журнала.
 * Журналы, выключенные на объекте, тоже остаются. В журнал действий каждой
 * организации — id перенесённых и оставленных документов: перенос можно
 * вернуть. `dryRun` — только посчитать.
 */
export async function moveOfficeJournalsToPoints(options: { dryRun: boolean }): Promise<OfficeJournalsMove[]> {
  const offices = await db.building.findMany({
    where: { kind: OFFICE_BUILDING_KIND },
    select: { id: true, organizationId: true },
    orderBy: { organizationId: "asc" },
  });
  const moves: OfficeJournalsMove[] = [];
  for (const office of offices) {
    const organizationId = office.organizationId;
    const where = { organizationId, buildingId: office.id };
    const [officeDocuments, officePaper] = await Promise.all([
      db.journalDocument.findMany({
        where,
        select: { id: true, dateFrom: true, dateTo: true, template: { select: { code: true } } },
      }),
      db.paperJournalDocument.findMany({ where, select: { id: true, journalId: true, dateFrom: true, dateTo: true } }),
    ]);
    if (officeDocuments.length === 0 && officePaper.length === 0) continue;

    const target = await db.building.findFirst({
      where: { organizationId, NOT: { kind: OFFICE_BUILDING_KIND } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    if (!target) {
      const none = { move: [], overlap: [], disabled: [] };
      moves.push({ organizationId, officeId: office.id, targetId: null, documents: counts(none), paperDocuments: counts(none) });
      continue;
    }

    const [targetDocuments, targetPaper, disabledCodes, disabledPaper] = await Promise.all([
      db.journalDocument.findMany({
        where: { organizationId, buildingId: target.id, template: { code: { in: officeDocuments.map((document) => document.template.code) } } },
        select: { dateFrom: true, dateTo: true, template: { select: { code: true } } },
      }),
      db.paperJournalDocument.findMany({
        where: { organizationId, buildingId: target.id, journalId: { in: officePaper.map((document) => document.journalId) } },
        select: { journalId: true, dateFrom: true, dateTo: true },
      }),
      getDisabledJournalCodes(organizationId, target.id),
      getDisabledPaperJournalIds(organizationId, target.id),
    ]);
    const documentPlan = planOfficeJournalMoves(
      officeDocuments.map((document) => ({ id: document.id, key: document.template.code, dateFrom: document.dateFrom, dateTo: document.dateTo })),
      targetDocuments.map((document) => ({ key: document.template.code, dateFrom: document.dateFrom, dateTo: document.dateTo })),
      disabledCodes,
    );
    const paperPlan = planOfficeJournalMoves(
      officePaper.map((document) => ({ id: document.id, key: document.journalId, dateFrom: document.dateFrom, dateTo: document.dateTo })),
      targetPaper.map((document) => ({ key: document.journalId, dateFrom: document.dateFrom, dateTo: document.dateTo })),
      disabledPaper,
    );
    moves.push({
      organizationId,
      officeId: office.id,
      targetId: target.id,
      documents: counts(documentPlan),
      paperDocuments: counts(paperPlan),
    });
    if (options.dryRun || (documentPlan.move.length === 0 && paperPlan.move.length === 0)) continue;
    await db.$transaction([
      db.journalDocument.updateMany({
        where: { ...where, id: { in: documentPlan.move } },
        data: { buildingId: target.id },
      }),
      db.paperJournalDocument.updateMany({
        where: { ...where, id: { in: paperPlan.move } },
        data: { buildingId: target.id },
      }),
      db.auditLog.create({
        data: {
          organizationId,
          userName: "WeSetup",
          action: "journals.office_to_point",
          entity: "building",
          entityId: target.id,
          // Всё для возврата: что перенесли и что оставили на офисе и почему.
          details: {
            officeId: office.id,
            targetId: target.id,
            movedDocumentIds: documentPlan.move,
            movedPaperDocumentIds: paperPlan.move,
            keptAsOverlap: { documents: documentPlan.overlap, paper: paperPlan.overlap },
            keptAsDisabled: { documents: documentPlan.disabled, paper: paperPlan.disabled },
          },
        },
      }),
    ]);
  }
  return moves;
}
