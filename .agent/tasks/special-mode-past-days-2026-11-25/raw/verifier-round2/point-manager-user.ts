// Verifier round 2: temporary point manager (role manager + preset admin = admin.full, but point-scoped:
// buildingIds = one point of the demo org, perLocationJournals on). Created and deleted by the verifier.
// Usage from repo root: npx tsx <this file> <buildingId> | npx tsx <this file> delete
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const EMAIL = "point-mgr-e2e-verifier2@haccp.local";
const PASSWORD = "point-mgr-e2e-2026";

async function main() {
  if (process.argv[2] === "delete") {
    const user = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
    if (user) {
      await db.journalDocumentEntry.deleteMany({ where: { employeeId: user.id } });
      await db.user.delete({ where: { id: user.id } }).catch(async () => {
        await db.user.update({ where: { id: user.id }, data: { isActive: false, archivedAt: new Date() } });
      });
    }
    console.log(JSON.stringify({ deleted: Boolean(user) }));
    return;
  }
  const buildingId = process.argv[2];
  if (!buildingId) throw new Error("buildingId required");
  const admin = await db.user.findFirst({ where: { email: "admin@haccp.local" }, select: { organizationId: true, legalVersion: true } });
  if (!admin) throw new Error("no admin@haccp.local");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const data = {
    passwordHash,
    isActive: true,
    archivedAt: null,
    role: "manager",
    permissionPreset: "admin",
    organizationId: admin.organizationId,
    legalVersion: admin.legalVersion,
    buildingIds: [buildingId],
  };
  const existing = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db.user.create({ data: { ...data, email: EMAIL, name: "Руководитель точки e2e верификатор 2" }, select: { id: true } });
  console.log(JSON.stringify({ pointManagerId: user.id, email: EMAIL, password: PASSWORD, buildingId }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
