import { db } from "../tg-session";
(async () => {
  const eq = await db.equipment.findMany({ where: { area: { organizationId: "e2e-org-a" } }, select: { id: true, name: true, type: true, tempMin: true, tempMax: true, area: { select: { name: true } } } });
  console.log(JSON.stringify(eq, null, 1));
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0,800)); process.exit(1); });
