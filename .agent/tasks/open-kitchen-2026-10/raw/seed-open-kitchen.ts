import { db } from "@/lib/db";
import { orgTodayKey } from "@/lib/timezone";

// Local fixtures for the «Сегодня» block: school org with points, brakerage dishes,
// daily samples, vitaminization, hygiene entries, cleaning marks.
async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { name: "Тестовая организация HACCP Demo" } });
  await db.organization.update({
    where: { id: org.id },
    data: { type: "education", badgeEnabled: true, badgeCode: org.badgeCode ?? "kidskitchen", badgeTodayEnabled: true },
  });
  const today = orgTodayKey("Europe/Moscow", new Date());
  const y = new Date(`${today}T00:00:00.000Z`); y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const from = new Date(`${today.slice(0, 8)}01T00:00:00.000Z`);
  const to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 1); to.setUTCDate(0);
  const tpl = async (code: string) => db.journalTemplate.findFirstOrThrow({ where: { code }, select: { id: true } });
  const employee = await db.user.findFirstOrThrow({ where: { organizationId: org.id, isActive: true }, select: { id: true } });
  const building = "loc-p01";
  async function doc(code: string, config: unknown) {
    const t = await tpl(code);
    await db.journalDocument.deleteMany({ where: { organizationId: org.id, templateId: t.id, buildingId: building, title: { startsWith: "[fixture]" } } });
    return db.journalDocument.create({
      data: { templateId: t.id, organizationId: org.id, title: `[fixture] ${code}`, dateFrom: from, dateTo: to, status: "active", config: config as never, buildingId: building },
    });
  }
  await doc("finished_product", {
    rows: [
      { id: "r1", productionDateTime: `${today}T08:05`, rejectionTime: "08:15", productName: "Каша молочная овсяная с маслом", portionWeight: "200/5", organolepticResult: "Отлично", releaseAllowed: "yes", inspectorName: "Секретно И. И." },
      { id: "r2", productionDateTime: `${today}T08:10`, rejectionTime: "08:20", productName: "Какао с молоком", portionWeight: "200", organolepticResult: "Отлично", releaseAllowed: "yes" },
      { id: "r3", productionDateTime: `${today}T11:40`, rejectionTime: "11:50", productName: "Суп гороховый с гренками", portionWeight: "250/15", organolepticResult: "Хорошо", releaseAllowed: "yes" },
      { id: "r4", productionDateTime: `${today}T11:45`, rejectionTime: "11:55", productName: "Котлета куриная, пюре картофельное", portionWeight: "80/150", organolepticResult: "Отлично", releaseAllowed: "yes" },
      { id: "r5", productionDateTime: `${today}T11:50`, rejectionTime: "12:00", productName: "Компот из сухофруктов (витаминизирован)", portionWeight: "200", organolepticResult: "Отлично", releaseAllowed: "yes" },
      { id: "r6", productionDateTime: `${yesterday}T12:00`, rejectionTime: "12:05", productName: "Вчерашний борщ", releaseAllowed: "yes" },
    ],
  });
  await doc("daily_samples", { rows: [{ id: "s1", values: { date: today, meal: "Завтрак", dish: "Каша", mass: "100" } }, { id: "s2", values: { date: yesterday, meal: "Обед", dish: "Борщ" } }] });
  await doc("vitaminization", { rows: [{ id: "v1", values: { date: yesterday, dish: "Компот", preparation: "Аскорбиновая кислота" } }] });
  await doc("cleaning", { rooms: [{ id: "room1", name: "Горячий цех" }], matrix: { room1: { [today]: "✓", [yesterday]: "✓" } } });
  const hygiene = await doc("hygiene", {});
  for (const day of [today, yesterday]) {
    await db.journalDocumentEntry.create({ data: { documentId: hygiene.id, employeeId: employee.id, date: new Date(`${day}T00:00:00.000Z`), data: { healthStatus: "healthy" } } });
  }
  const cold = await doc("cold_equipment_control", {});
  await db.journalDocumentEntry.create({ data: { documentId: cold.id, employeeId: employee.id, date: new Date(`${yesterday}T00:00:00.000Z`), data: { temperatures: {} } } });
  console.log(JSON.stringify({ org: org.id, code: (await db.organization.findUnique({ where: { id: org.id }, select: { badgeCode: true } }))?.badgeCode, today, yesterday }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
