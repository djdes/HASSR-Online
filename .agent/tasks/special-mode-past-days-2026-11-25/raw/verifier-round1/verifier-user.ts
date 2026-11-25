// Verifier stand helper: create (or delete with "delete") a temporary staff user with
// tasks.verify (role cook + permissionPreset head_chef) in the demo org.
import bcrypt from "/home/user/HASSR-Online/node_modules/bcryptjs";
import { db } from "@/lib/db";

const EMAIL = "verifier-e2e-verify@haccp.local";
const PASSWORD = "verify-e2e-2026";

async function main() {
  if (process.argv[2] === "delete") {
    const user = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
    if (user) {
      await db.journalDocumentEntry.deleteMany({ where: { employeeId: user.id } }).catch(() => null);
      await db.user.delete({ where: { id: user.id } }).catch(async (error) => {
        console.error("delete failed, archiving instead:", error?.message);
        await db.user.update({ where: { id: user.id }, data: { isActive: false, archivedAt: new Date() } });
      });
    }
    console.log(JSON.stringify({ deleted: Boolean(user) }));
    return;
  }
  const admin = await db.user.findFirst({ where: { email: "admin@haccp.local" }, select: { id: true, organizationId: true, legalVersion: true } });
  if (!admin) throw new Error("no admin@haccp.local");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const data = { passwordHash, isActive: true, archivedAt: null, role: "cook", permissionPreset: "head_chef", organizationId: admin.organizationId, legalVersion: admin.legalVersion };
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db.user.create({ data: { ...data, email: EMAIL, name: "Проверяющий e2e (верификатор)" }, select: { id: true } });
  console.log(JSON.stringify({ id: user.id, email: EMAIL, password: PASSWORD, organizationId: admin.organizationId }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
