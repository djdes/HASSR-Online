/**
 * Стенд (не для прода), замечание (1) третьей проверки: «первый объект» для
 * документа, пришедшего с офисом, — тот же, что у переноса журналов офиса и
 * у списка объектов (порядок базы: sortOrder, затем название). Временная
 * организация «office-order-check-*»: офис + «Cafe Mira» + «Кафе» (оба
 * sortOrder 0) и документ гигиены на офисе. Удаляется в конце.
 * Запуск: npx tsx .agent/tasks/office-objects-favorites-2026-11-23/raw/repro-first-object-order.ts
 */
import "dotenv/config";
import { db } from "../../../../src/lib/db";
import { ensureActiveDocument } from "../../../../src/lib/journal-auto-create";
import { documentBuildingFor } from "../../../../src/lib/office-journals";
import { moveOfficeJournalsToPoints } from "../../../../src/lib/office-journals.server";

const PREFIX = "office-order-check";

async function cleanup() {
  const orgs = await db.organization.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  for (const { id } of orgs) {
    await db.journalDocumentEntry.deleteMany({ where: { document: { organizationId: id } } });
    await db.journalEntry.deleteMany({ where: { organizationId: id } });
    await db.notification.deleteMany({ where: { organizationId: id } });
    await db.auditLog.deleteMany({ where: { organizationId: id } });
    await db.journalDocument.deleteMany({ where: { organizationId: id } });
    await db.building.deleteMany({ where: { organizationId: id } });
    await db.organization.delete({ where: { id } });
  }
  return db.organization.count({ where: { name: { startsWith: PREFIX } } });
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("stand only");
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("local DB only");
  const hygiene = await db.journalTemplate.findFirst({ where: { code: "hygiene" }, select: { id: true } });
  if (!hygiene) throw new Error("hygiene template missing");
  const result: Record<string, unknown> = {};
  try {
    const org = await db.organization.create({ data: { name: `${PREFIX}-${Date.now()}`, type: "restaurant", perLocationJournals: true } });
    const office = await db.building.create({ data: { organizationId: org.id, name: "Офис", kind: "office", sortOrder: 0 } });
    const latin = await db.building.create({ data: { organizationId: org.id, name: "Cafe Mira", sortOrder: 0 } });
    const cyr = await db.building.create({ data: { organizationId: org.id, name: "Кафе", sortOrder: 0 } });
    const label = (id: string | null | undefined) => (id === office.id ? "ОФИС" : id === latin.id ? "Cafe Mira" : id === cyr.id ? "Кафе" : String(id));
    await db.journalDocument.create({
      data: { templateId: hygiene.id, organizationId: org.id, title: "Гигиена офиса", dateFrom: new Date(Date.UTC(2026, 10, 1)), dateTo: new Date(Date.UTC(2026, 10, 15)), buildingId: office.id },
    });
    const list = await db.building.findMany({ where: { organizationId: org.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true } });
    const transfer = (await moveOfficeJournalsToPoints({ dryRun: true })).find((move) => move.organizationId === org.id);
    const active = await ensureActiveDocument(db, { organizationId: org.id, templateCode: "health_check", now: new Date(Date.UTC(2026, 10, 24, 9)), buildingId: office.id });
    const activeDoc = active.documentId ? await db.journalDocument.findUnique({ where: { id: active.documentId }, select: { buildingId: true } }) : null;
    Object.assign(result, {
      objectsListOrder: list.map((building) => label(building.id)),
      transferTarget: label(transfer?.targetId ?? null),
      documentBuildingFor: label(await documentBuildingFor(db, org.id, office.id)),
      ensureActiveDocumentWithOffice: label(activeDoc?.buildingId ?? null),
    });
    result.sameObject =
      result.transferTarget === result.documentBuildingFor && result.documentBuildingFor === result.ensureActiveDocumentWithOffice;
  } finally {
    result.leftoverTempOrgs = await cleanup();
  }
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
