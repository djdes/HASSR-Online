/** Записи в документах точек А и Б (локальная wesetup_iso, не прод). */
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";

const DIR = ".agent/tasks/point-isolation-audit-2026-11-01/raw";
async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_iso")) throw new Error("wesetup_iso only");
  const fx = JSON.parse(readFileSync(`${DIR}/fixture.json`, "utf8"));
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const [key, cook, tag] of [["A", fx.users.cookA.id, "Альфа"], ["B", fx.users.cookB.id, "Бета"]] as const) {
    for (const [code, data] of [["hygiene", { status: "healthy", note: `Гигиена ${tag}` }], ["health_check", { signed: true, note: `Здоровье ${tag}` }]] as const) {
      await db.journalDocumentEntry.upsert({
        where: { documentId_employeeId_date: { documentId: fx.docs[code][key], employeeId: cook, date: today } },
        update: { data },
        create: { documentId: fx.docs[code][key], employeeId: cook, date: today, data },
      } as never);
    }
  }
  const tpl = await db.journalTemplate.findUniqueOrThrow({ where: { code: "cold_equipment_control" }, select: { id: true } });
  for (const [fridge, area, cook, tag] of [[fx.fridgeA, fx.areaA, fx.users.cookA.id, "Альфа"], [fx.fridgeB, fx.areaB, fx.users.cookB.id, "Бета"]] as const) {
    await db.journalEntry.create({ data: { templateId: tpl.id, organizationId: fx.orgId, filledById: cook, equipmentId: fridge, areaId: area, data: { temperature: 4, comment: `Запись ${tag}` } } as never });
  }
  console.log("ok");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
