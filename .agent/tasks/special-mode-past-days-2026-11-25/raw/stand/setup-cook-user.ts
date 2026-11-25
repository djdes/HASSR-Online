// Стенд спецрежима: повар демо-организации с известным паролем и активный документ гигиены за текущий месяц.
// Запуск из корня репозитория: npx tsx <этот файл> (DATABASE_URL — локальная база стенда).
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const EMAIL = "cook-e2e-special@haccp.local";
const PASSWORD = "cook-e2e-2026";

async function main() {
  const admin = await db.user.findFirst({ where: { email: "admin@haccp.local" }, select: { id: true, organizationId: true } });
  if (!admin) throw new Error("нет admin@haccp.local");
  const organizationId = admin.organizationId;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const cook = existing
    ? await db.user.update({ where: { id: existing.id }, data: { passwordHash, isActive: true, archivedAt: null, role: "cook", organizationId }, select: { id: true } })
    : await db.user.create({
        data: { email: EMAIL, name: "Повар e2e спецрежим", passwordHash, role: "cook", organizationId, isActive: true },
        select: { id: true },
      });
  const today = new Date();
  const doc = await db.journalDocument.findFirst({
    where: {
      organizationId,
      status: "active",
      autoFill: false,
      template: { code: "hygiene" },
      dateFrom: { lte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)) },
      dateTo: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, dateFrom: true, dateTo: true, buildingId: true, title: true },
  });
  console.log(JSON.stringify({ organizationId, adminId: admin.id, cookId: cook.id, email: EMAIL, password: PASSWORD, doc }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
