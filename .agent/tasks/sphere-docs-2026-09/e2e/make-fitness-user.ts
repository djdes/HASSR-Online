import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
import { defaultDisabledCodesFor } from "../../../../src/lib/sphere-journal-rules";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
// Fresh fitness org for B2 e2e: same disabled set the anketa writes for a new org.
async function main() {
  const email = "e2e-b2-fitness@wesetup.local";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.organization.delete({ where: { id: existing.organizationId } });
    console.log("removed previous org", existing.organizationId);
  }
  const org = await prisma.organization.create({
    data: {
      name: "E2E Фитнес-клуб (wt-b)",
      type: "fitness",
      disabledJournalCodes: defaultDisabledCodesFor("fitness"),
    },
  });
  await prisma.user.create({
    data: {
      email,
      name: "Ирина Тренерова",
      role: "owner",
      organizationId: org.id,
      isActive: true,
      journalAccessMigrated: true,
      passwordHash: await bcrypt.hash("E2e-pass-123", 10),
    },
  });
  const all = await prisma.journalTemplate.findMany({ where: { isActive: true }, select: { code: true } });
  const disabled = new Set(defaultDisabledCodesFor("fitness"));
  console.log("created", org.id);
  console.log("enabled:", all.map((t) => t.code).filter((c) => !disabled.has(c)).join(","));
}
main().finally(async () => { await prisma.$disconnect(); await pool.end(); });
