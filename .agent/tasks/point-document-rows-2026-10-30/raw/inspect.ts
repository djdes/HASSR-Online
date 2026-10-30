// e2e-БД: что осталось в базе после открытия документов точки А.
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const fx = JSON.parse(readFileSync(".agent/tasks/point-document-rows-2026-10-30/raw/fixture.json", "utf8"));
  const cold = await db.journalDocument.findUniqueOrThrow({ where: { id: fx.coldId }, select: { config: true } });
  const rows = ((cold.config as { equipment?: Array<{ name: string }> }).equipment ?? []).map((row) => row.name);
  console.log(`${rows.length === 1 && rows[0] === fx.fridgeA ? "PASS" : "FAIL"} конфиг холодильников точки А в БД: ${JSON.stringify(rows)}`);
  const entries = await db.journalDocumentEntry.findMany({ where: { documentId: fx.hygieneId }, select: { employee: { select: { name: true } } } });
  const names = entries.map((entry) => entry.employee.name).sort();
  console.log(`${names.some((name) => name.includes("Борис")) ? "PASS" : "FAIL"} записи гигиены не удалены (Борис в БД остаётся): ${JSON.stringify(names)}`);
}
main().finally(() => db.$disconnect());
