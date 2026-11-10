/**
 * Offline pack on an organization with two points (LOCAL demo database only).
 * Reproduces the owner's case: the tablet is signed in by a manager of the
 * point «Офис», the poster belongs to the point «Д/с №68». The poster must
 * open the document and the staff of its own point.
 *
 *   npx tsx .agent/tasks/offline-qr-point-2026-11/e2e/pack-points.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Session } from "next-auth";

import { db } from "@/lib/db";
import { journalFillSubject } from "@/lib/journal-fill";
import { offlineDocumentSignerIds, offlinePointDocuments, resolveOfflineQr, scopeOfflinePack } from "@/lib/offline/offline-logic";
import { buildOfflinePack } from "@/lib/offline/pack.server";
import { parseOfflineQr } from "@/lib/offline/qr-url";
import { mintQrFillToken } from "@/lib/qr-fill-token";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("local database only");
  const org = await db.organization.findFirstOrThrow({ where: { id: { not: "platform" } } });
  const office = await db.building.findFirstOrThrow({ where: { organizationId: org.id } });
  const users = await db.user.findMany({ where: { organizationId: org.id, isActive: true, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, buildingIds: true } });
  const manager = users.find((user) => ["owner", "manager"].includes(user.role)) ?? users[0];
  const staff = users.filter((user) => user.id !== manager.id);
  const gardenStaff = staff.slice(0, 3);
  const officeStaff = staff.slice(3, 5);
  const before = { perLocationJournals: org.perLocationJournals, users: users.map((user) => ({ id: user.id, buildingIds: user.buildingIds })) };
  const hygiene = await db.journalDocument.findFirstOrThrow({ where: { organizationId: org.id, template: { code: "hygiene" }, status: "active" } });
  const hygieneBefore = hygiene.buildingId;

  const garden = await db.building.create({ data: { organizationId: org.id, name: "Д/с №68 (проверка)" } });
  let gardenDocId: string | null = null;
  try {
    await db.organization.update({ where: { id: org.id }, data: { perLocationJournals: true } });
    await db.user.updateMany({ where: { id: { in: [manager.id, ...officeStaff.map((user) => user.id)] } }, data: { buildingIds: [office.id] } });
    await db.user.updateMany({ where: { id: { in: gardenStaff.map((user) => user.id) } }, data: { buildingIds: [garden.id] } });
    await db.user.updateMany({ where: { id: { in: staff.slice(5).map((user) => user.id) } }, data: { buildingIds: [office.id] } });
    await db.journalDocument.update({ where: { id: hygiene.id }, data: { buildingId: office.id } });
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = hygiene;
    void _id; void _c; void _u;
    const gardenDoc = await db.journalDocument.create({ data: { ...copy, config: copy.config ?? undefined, buildingId: garden.id } as never });
    gardenDocId = gardenDoc.id;

    const session = { user: { id: manager.id, name: manager.name, organizationId: org.id, role: manager.role }, expires: "" } as unknown as Session;
    const pack = await buildOfflinePack(session);
    if (!pack) throw new Error("no pack");
    const journal = pack.journals.find((item) => item.code === "hygiene");
    check("в данных есть точки организации", pack.points.length === 2, pack.points.map((point) => `${point.name}: ${point.employeeIds.length}`).join("; "));
    check("гигиенический журнал содержит документы обеих точек", Boolean(journal && journal.documents.some((doc) => doc.buildingId === office.id) && journal.documents.some((doc) => doc.buildingId === garden.id)), journal?.documents.map((doc) => doc.building ?? "общий").join(", "));
    if (!journal) throw new Error("no hygiene journal in the pack");

    // The poster of the point, exactly as the site prints it.
    const token = mintQrFillToken("journal", journalFillSubject(org.id, "hygiene", null, { buildingId: garden.id }));
    const parsed = parseOfflineQr(`https://wesetup.ru/journal-fill/${org.id}/hygiene?token=${encodeURIComponent(token)}`);
    check("адрес плаката разобран, точка прочитана из токена", parsed.ok && parsed.target.kind === "journal" && parsed.target.buildingId === garden.id);
    if (!parsed.ok || parsed.target.kind !== "journal") throw new Error("poster not parsed");
    check("плакат открывает журнал из сохранённых данных", resolveOfflineQr(pack, parsed.target).kind === "journal");
    const docs = offlinePointDocuments(pack, journal, parsed.target.buildingId, parsed.target.documentId);
    check("плакат точки открывает документ этой точки, а не офиса", docs.length === 1 && docs[0].id === gardenDocId, docs.map((doc) => doc.building).join(", "));
    const signers = offlineDocumentSignerIds(pack, docs[0], parsed.target.buildingId).sort();
    const expected = gardenStaff.map((user) => user.id).sort();
    check("«Кто вы?» — сотрудники точки плаката", JSON.stringify(signers) === JSON.stringify(expected), `${signers.length} из ожидаемых ${expected.length}: ${pack.employees.filter((employee) => signers.includes(employee.id)).map((employee) => employee.name).join(", ")}`);
    check("вошедшего руководителя офиса в списке точки нет", !signers.includes(manager.id));
    check("у каждого сотрудника точки есть форма", signers.every((id) => Boolean(docs[0].forms[`employee-${id}`])));

    const officeHome = scopeOfflinePack(pack, office.id).journals.find((item) => item.code === "hygiene");
    check("главный экран офиса показывает документ офиса", officeHome?.documents.length === 1 && officeHome.documents[0].buildingId === office.id);
    const hubToken = mintQrFillToken("journal", journalFillSubject(org.id, "all", null, { buildingId: garden.id }));
    const hub = parseOfflineQr(`/journal-fill/${org.id}/all?token=${encodeURIComponent(hubToken)}`);
    check("«Все журналы» точки: точка прочитана", hub.ok && hub.target.kind === "journal" && hub.target.hub && hub.target.buildingId === garden.id);
    check("объекты другой точки есть в данных", pack.objects.length > 0, `${pack.objects.length} объектов`);
  } finally {
    if (gardenDocId) await db.journalDocument.delete({ where: { id: gardenDocId } }).catch(() => undefined);
    await db.journalDocument.update({ where: { id: hygiene.id }, data: { buildingId: hygieneBefore } });
    for (const user of before.users) await db.user.update({ where: { id: user.id }, data: { buildingIds: user.buildingIds } });
    await db.organization.update({ where: { id: org.id }, data: { perLocationJournals: before.perLocationJournals } });
    await db.building.delete({ where: { id: garden.id } }).catch(() => undefined);
  }
  writeFileSync(path.join(__dirname, "../raw/pack-points.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  if (results.some((item) => !item.ok)) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
