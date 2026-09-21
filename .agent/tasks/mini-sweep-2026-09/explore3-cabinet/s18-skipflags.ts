import { db } from "../tg-session";
(async () => {
const t = await db.journalTemplate.findMany({ select: { code: true, name: true, allowNoEvents: true }, orderBy: { code: "asc" } });
console.log("allowNoEvents=false:", t.filter(x=>!x.allowNoEvents).map(x=>x.code).join(", "));
console.log("allowNoEvents=true count:", t.filter(x=>x.allowNoEvents).length, "of", t.length);
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,600));process.exit(1);});
