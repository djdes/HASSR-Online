// Разведка стенда: шаблоны журналов, виды периодов, есть ли e2e-org-qr.
import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { resolveJournalPeriodKind } from "../../../../src/lib/journal-period";

async function main() {
  const templates = await db.journalTemplate.findMany({ where: { isActive: true }, select: { code: true, name: true, taskScope: true }, orderBy: { code: "asc" } });
  for (const t of templates) console.log(t.code.padEnd(36), resolveJournalPeriodKind(t.code).padEnd(12), t.taskScope, "|", t.name.slice(0, 60));
  console.log("count", templates.length);
  const org = await db.organization.findUnique({ where: { id: "e2e-org-qr" }, select: { id: true } });
  console.log("org exists:", Boolean(org));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
