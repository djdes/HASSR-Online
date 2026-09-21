import { db } from "../tg-session";
(async () => {
  const t = await db.journalTemplate.findMany({ where: { code: { in: ["health_check","hygiene","cold_equipment_control","pest_control","finished_product"] } }, select: { code: true, allowNoEvents: true, taskScope: true } });
  console.log(JSON.stringify(t, null, 1));
  await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,500));process.exit(1);});
