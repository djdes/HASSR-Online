// Local fixture for the platform panel checks — LOCAL DB ONLY (wesetup_root).
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/wesetup_root?sslmode=disable npx tsx .agent/tasks/root-admin-2026-10-29/raw/seed-local.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { LEGAL_VERSION } from "../../../../src/lib/legal-consent";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:5432|localhost:5432/.test(url) || /:5433/.test(url)) throw new Error("Local DB only");
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) });

async function main() {
  const owner = await db.user.findUniqueOrThrow({ where: { email: "dk-owner@test.local" }, select: { passwordHash: true } });
  await db.organization.upsert({
    where: { id: "platform" },
    create: { id: "platform", name: "WeSetup Platform", type: "restaurant" },
    update: {},
  });
  await db.user.upsert({
    where: { email: "root@test.local" },
    create: { email: "root@test.local", name: "Владелец Платформы", role: "manager", organizationId: "platform", isRoot: true, passwordHash: owner.passwordHash, legalVersion: LEGAL_VERSION },
    update: { isRoot: true, passwordHash: owner.passwordHash, legalVersion: LEGAL_VERSION },
  });
  // Contacts for the client card: owner's personal e-mail, accountant, company phone.
  await db.user.update({ where: { email: "dk-owner@test.local" }, data: { contactEmail: "olga@dk-example.ru", legalVersion: LEGAL_VERSION, platformSections: [] } });
  await db.user.update({ where: { email: "dk-chef@test.local" }, data: { legalVersion: LEGAL_VERSION, platformSections: [] } });
  await db.organization.update({ where: { id: "org-dk" }, data: { phone: "+7 (495) 000-11-22", accountantEmail: "buh@dk-example.ru", inn: "5018215599" } });
  console.log("seeded");
}

main().finally(() => db.$disconnect());
