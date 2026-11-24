/**
 * Стенд (не для прода): состояние офиса по организациям — для проверки
 * разового шага выкладки (подсчёт → открытие → повтор).
 * Запуск: npx tsx .agent/tasks/office-default-login-leak-2026-11-24/raw/org-office-state.ts
 */
import "dotenv/config";
import { db } from "../../../../src/lib/db";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("stand only");
  const orgs = await db.organization.findMany({
    select: { name: true, kind: true, perLocationJournals: true, buildings: { select: { kind: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const org of orgs) {
    const offices = org.buildings.filter((building) => building.kind === "office").length;
    console.log(JSON.stringify({ name: org.name.slice(0, 40), kind: org.kind, split: org.perLocationJournals, objects: org.buildings.length - offices, offices }));
  }
}

main().finally(() => db.$disconnect());
