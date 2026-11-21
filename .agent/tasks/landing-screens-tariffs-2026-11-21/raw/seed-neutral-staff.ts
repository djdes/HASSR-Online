// Демо-база для снимков: нейтральная организация для экрана «Сотрудники»
// (должности не из общепита). Вход: owner@example.local / demo12345.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })) });

const POSITIONS = [
  { key: "lead", categoryKey: "management", name: "Руководитель", sortOrder: 0 },
  { key: "admin", categoryKey: "staff", name: "Администратор", sortOrder: 0 },
  { key: "specialist", categoryKey: "staff", name: "Специалист", sortOrder: 1 },
  { key: "cleaner", categoryKey: "staff", name: "Уборщик", sortOrder: 2 },
] as const;
const USERS = [
  { email: "owner@example.local", name: "Иванова Анна Сергеевна", role: "owner", position: "lead" },
  { email: "admin@example.local", name: "Петров Олег Викторович", role: "manager", position: "admin" },
  { email: "specialist@example.local", name: "Смирнова Елена Игоревна", role: "operator", position: "specialist" },
  { email: "cleaner1@example.local", name: "Кузнецова Ольга Петровна", role: "operator", position: "cleaner" },
  { email: "cleaner2@example.local", name: "Соколов Игорь Николаевич", role: "operator", position: "cleaner" },
  { email: "cleaner3@example.local", name: "Попова Мария Андреевна", role: "operator", position: "cleaner" },
] as const;

async function main() {
  const passwordHash = await bcrypt.hash("demo12345", 10);
  const organization =
    (await prisma.organization.findFirst({ where: { name: "ООО «Пример»" } })) ??
    (await prisma.organization.create({
      data: { name: "ООО «Пример»", type: "other", subscriptionPlan: "pro", subscriptionEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
    }));
  const positions = new Map<string, string>();
  for (const position of POSITIONS) {
    const existing = await prisma.jobPosition.findFirst({ where: { organizationId: organization.id, name: position.name } });
    const row = existing ?? (await prisma.jobPosition.create({ data: { organizationId: organization.id, categoryKey: position.categoryKey, name: position.name, sortOrder: position.sortOrder } }));
    positions.set(position.key, row.id);
  }
  for (const user of USERS) {
    const data = { name: user.name, role: user.role, organizationId: organization.id, jobPositionId: positions.get(user.position)!, passwordHash, isActive: true };
    await prisma.user.upsert({ where: { email: user.email }, update: data, create: { email: user.email, ...data } });
  }
  console.log(organization.id);
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
