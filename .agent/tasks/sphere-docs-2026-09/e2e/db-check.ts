import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
async function main() {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-b2-fitness@wesetup.local" } });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { checklistsReviewedAt: true, type: true } });
  const orders = await prisma.companyOrder.findMany({ where: { organizationId: u.organizationId }, select: { templateCode: true, number: true } });
  const items = await prisma.journalChecklistItem.findMany({ where: { organizationId: u.organizationId }, select: { journalCode: true, frequency: true, required: true, label: true }, orderBy: { sortOrder: "asc" } });
  const audit = await prisma.auditLog.findMany({ where: { organizationId: u.organizationId, action: { in: ["checklist.fill_defaults", "onboarding.checklists_reviewed"] } }, select: { action: true, details: true } });
  console.log(JSON.stringify({ org, orders, checklistItems: items.length, codes: [...new Set(items.map(i => i.journalCode))], first: items[0]?.label, audit }, null, 2));
}
main().finally(async () => { await prisma.$disconnect(); await pool.end(); });
