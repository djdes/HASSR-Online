/**
 * Срез базы после e2e: сфера и выключенные журналы организаций-фикстур,
 * пункты чек-листов (первые пункты по журналам), документы новых реестров
 * со строками, записи аудита «Заполнить типовыми».
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

if (!/wesetup_wt_mc/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("только для локальной базы wesetup_wt_mc");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const NEW_CODES = ["inventory_condition", "instrument_sterilization", "medical_waste_b", "batch_release"];

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: "e2e-bj-" } },
    select: { email: true, organizationId: true },
    orderBy: { email: "asc" },
  });
  const out = [];
  for (const u of users) {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: u.organizationId },
      select: { name: true, type: true, disabledJournalCodes: true },
    });
    const disabled = new Set(Array.isArray(org.disabledJournalCodes) ? (org.disabledJournalCodes as string[]) : []);
    const items = await prisma.journalChecklistItem.findMany({
      where: { organizationId: u.organizationId, archivedAt: null, roomId: null },
      select: { journalCode: true, label: true },
      orderBy: [{ journalCode: "asc" }, { sortOrder: "asc" }],
    });
    const checklists: Record<string, { count: number; first: string }> = {};
    for (const item of items) {
      checklists[item.journalCode] ??= { count: 0, first: item.label };
      checklists[item.journalCode].count += 1;
    }
    const docs = await prisma.journalDocument.findMany({
      where: { organizationId: u.organizationId, template: { code: { in: NEW_CODES } } },
      select: { id: true, title: true, config: true, template: { select: { code: true } } },
    });
    const audit = await prisma.auditLog.findMany({
      where: { organizationId: u.organizationId, action: "checklist.fill_defaults" },
      select: { details: true },
    });
    out.push({
      email: u.email,
      org: { name: org.name, type: org.type },
      newCodesEnabled: NEW_CODES.filter((c) => !disabled.has(c)),
      enabledSample: ["instrument_sterilization", "general_cleaning", "disinfectant_usage", "medical_waste_b", "cleaning", "hygiene"].map(
        (c) => `${c}=${!disabled.has(c)}`,
      ),
      checklists,
      registerDocs: docs.map((d) => ({
        code: d.template.code,
        id: d.id,
        rows: ((d.config as { rows?: Array<{ values: Record<string, string> }> } | null)?.rows ?? []).map((r) => r.values),
      })),
      fillDefaultsAudit: audit.map((a) => a.details),
    });
  }
  console.log(JSON.stringify(out, null, 2));
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
