import { db } from "../tg-session";
(async () => {
const v = await db.staffVacation.findMany({ include: { user: { select: { name: true, organizationId: true } } } });
console.log("VACATIONS", JSON.stringify(v.map(x=>({u:x.user.name,org:x.user.organizationId,from:x.startDate?.toISOString?.().slice(0,10)??x.startDate,to:x.endDate?.toISOString?.().slice(0,10)??x.endDate}))));
const sl = await db.staffSickLeave.findMany({ include: { user: { select: { name: true } } } });
console.log("SICK", JSON.stringify(sl.map(x=>({u:x.user.name}))));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,900));process.exit(1);});
