import { db, state } from "../tg-session";
(async () => {
  const rows = await db.workShift.findMany({ where: { userId: state.users.cookA.id }, orderBy: { date: "desc" }, take: 5 });
  console.log("смены повара:", JSON.stringify(rows, null, 1).slice(0, 900));
  await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,500));process.exit(1);});
