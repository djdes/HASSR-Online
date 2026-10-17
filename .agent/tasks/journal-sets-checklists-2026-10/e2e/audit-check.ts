/**
 * AC2 на базе: каждое включение набором — запись `journal.enable` в AuditLog
 * с `via: "journal-set"`; типовой шаблон — `checklist.template_create`.
 * Запускать после api-check.mjs (база wesetup_e2e, НЕ прод):
 *
 *   npx tsx .agent/tasks/journal-sets-checklists-2026-10/e2e/audit-check.ts
 */
import "dotenv/config";
import fs from "node:fs";

import { db } from "@/lib/db";

const DIR = ".agent/tasks/journal-sets-checklists-2026-10/raw";

async function main() {
  if (!/wesetup_e2e/.test(process.env.DATABASE_URL ?? "")) throw new Error("Только локальная база wesetup_e2e");
  const state = JSON.parse(fs.readFileSync(`${DIR}/e2e-state.json`, "utf8"));
  const rows = await db.auditLog.findMany({
    where: { organizationId: state.restaurant, action: { in: ["journal.enable", "checklist.template_create"] } },
    orderBy: { createdAt: "asc" },
    select: { action: true, entityId: true, details: true, userId: true },
  });
  const enable = rows.filter((row) => row.action === "journal.enable");
  const viaSet = enable.filter((row) => (row.details as { via?: string } | null)?.via === "journal-set");
  const typical = rows.filter((row) => row.action === "checklist.template_create");
  const result = {
    journalEnableTotal: enable.length,
    journalEnableViaSet: viaSet.length,
    viaSetCodes: viaSet.map((row) => row.entityId),
    viaSetSets: [...new Set(viaSet.map((row) => (row.details as { journalSet?: string } | null)?.journalSet))],
    allByManager: viaSet.every((row) => row.userId === state.managerId),
    typicalCreated: typical.map((row) => (row.details as { typical?: string } | null)?.typical),
  };
  fs.writeFileSync(`${DIR}/db-audit-log.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
