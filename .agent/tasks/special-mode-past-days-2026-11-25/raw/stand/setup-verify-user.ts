// Стенд спецрежима: временный сотрудник с «проверкой задач» без admin.full (роль cook + набор прав head_chef).
// Запуск из корня репозитория: npx tsx <этот файл> [delete] (DATABASE_URL — локальная база стенда).
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const EMAIL = "verify-e2e-special@haccp.local";
const PASSWORD = "verify-e2e-2026";

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
  const admin = await db.user.findFirst({ where: { email: "admin@haccp.local" }, select: { organizationId: true, legalVersion: true } });
  if (!admin) throw new Error("нет admin@haccp.local");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const data = { passwordHash, isActive: true, archivedAt: null, role: "cook", permissionPreset: "head_chef", organizationId: admin.organizationId, legalVersion: admin.legalVersion };
  const existing = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db.user.create({ data: { ...data, email: EMAIL, name: "Проверка задач e2e спецрежим" }, select: { id: true } });
  console.log(JSON.stringify({ verifyId: user.id, verifyEmail: EMAIL, verifyPassword: PASSWORD }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
