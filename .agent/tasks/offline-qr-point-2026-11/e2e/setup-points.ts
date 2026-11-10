/**
 * Two points on the LOCAL demo database for point-qr.e2e.mjs:
 *   npx tsx setup-points.ts up    — second point, its staff and its hygiene document; prints the poster address
 *   npx tsx setup-points.ts down  — back to how it was
 */
import "dotenv/config";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db";
import { journalFillSubject } from "@/lib/journal-fill";
import { mintQrFillToken } from "@/lib/qr-fill-token";

const stateFile = path.join(__dirname, "../raw/points-state.json");

async function up() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("local database only");
  if (existsSync(stateFile)) throw new Error("already set up — run `down` first");
  const org = await db.organization.findFirstOrThrow({ where: { id: { not: "platform" } } });
  const office = await db.building.findFirstOrThrow({ where: { organizationId: org.id } });
  const users = await db.user.findMany({ where: { organizationId: org.id, isActive: true, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, buildingIds: true } });
  const admin = users.find((user) => user.email === "admin@haccp.local");
  if (!admin) throw new Error("demo admin not found");
  const gardenStaff = users.filter((user) => user.id !== admin.id).slice(0, 3);
  const hygiene = await db.journalDocument.findFirstOrThrow({ where: { organizationId: org.id, template: { code: "hygiene" }, status: "active" } });
  const garden = await db.building.create({ data: { organizationId: org.id, name: "Д/с №68" } });
  const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = hygiene;
  void _id; void _c; void _u;
  const gardenDoc = await db.journalDocument.create({ data: { ...copy, config: copy.config ?? undefined, buildingId: garden.id } as never });
  writeFileSync(stateFile, JSON.stringify({ orgId: org.id, perLocationJournals: org.perLocationJournals, gardenId: garden.id, gardenDocId: gardenDoc.id, hygieneId: hygiene.id, hygieneBuildingId: hygiene.buildingId, users: users.map((user) => ({ id: user.id, buildingIds: user.buildingIds })) }));
  await db.organization.update({ where: { id: org.id }, data: { perLocationJournals: true } });
  await db.user.updateMany({ where: { organizationId: org.id, id: { notIn: gardenStaff.map((user) => user.id) } }, data: { buildingIds: [office.id] } });
  await db.user.updateMany({ where: { id: { in: gardenStaff.map((user) => user.id) } }, data: { buildingIds: [garden.id] } });
  await db.journalDocument.update({ where: { id: hygiene.id }, data: { buildingId: office.id } });
  const token = mintQrFillToken("journal", journalFillSubject(org.id, "hygiene", null, { buildingId: garden.id }));
  console.log(JSON.stringify({ poster: `/journal-fill/${org.id}/hygiene?token=${token}`, office: office.name, garden: garden.name, gardenId: garden.id, gardenStaff: gardenStaff.map((user) => user.name), admin: admin.name }));
}

async function down() {
  if (!existsSync(stateFile)) return;
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  await db.auditLog.deleteMany({ where: { entity: "JournalDocument", entityId: state.gardenDocId } });
  await db.journalDocument.delete({ where: { id: state.gardenDocId } }).catch(() => undefined);
  await db.journalDocument.update({ where: { id: state.hygieneId }, data: { buildingId: state.hygieneBuildingId } });
  for (const user of state.users) await db.user.update({ where: { id: user.id }, data: { buildingIds: user.buildingIds } });
  await db.organization.update({ where: { id: state.orgId }, data: { perLocationJournals: state.perLocationJournals } });
  await db.building.delete({ where: { id: state.gardenId } }).catch((error) => console.log("building not removed:", String(error).slice(0, 120)));
  rmSync(stateFile);
  console.log("restored");
}

(process.argv[2] === "down" ? down() : up()).finally(() => db.$disconnect());
