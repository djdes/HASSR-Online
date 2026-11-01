/** Общий документ (без точки) для проверки печати (локальная wesetup_iso, не прод). */
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { ensureDocumentsFor } from "@/lib/journal-auto-create";

const DIR = ".agent/tasks/point-isolation-audit-2026-11-01/raw";
async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_iso")) throw new Error("wesetup_iso only");
  const fx = JSON.parse(readFileSync(`${DIR}/fixture.json`, "utf8"));
  const [report] = await ensureDocumentsFor(db, { organizationId: fx.orgId, templateCodes: ["tableware_breakage"], buildingIds: [null] });
  const doc = await db.journalDocument.findUniqueOrThrow({ where: { id: report.documentId }, select: { id: true, buildingId: true } });
  if (doc.buildingId !== null) throw new Error("ожидался общий документ");
  fx.more.sharedDoc = doc.id;
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(fx, null, 2));
  console.log(doc);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
