import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, dump } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
console.log("USER", JSON.stringify(s.user));
const org = await db.organization.findUnique({ where: { id: s.user.organizationId }, select: { id: true, name: true, timezone: true, shiftEndHour: true, taskFlowMode: true } });
console.log("ORG", JSON.stringify(org));
console.log("NOW utc", new Date().toISOString());

await go(s.page, s.base + "/mini/today", 4000);
const p = await probe(s.page);
console.log("URL", p.url, "overflow", p.overflow);
console.log(p.bodyText);
await shot(s.page, "01-today");

const today: any = await s.page.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
dump("01-today.json", today);
console.log("dateKey", today.dateKey);
for (const g of today.groups ?? []) {
  console.log("GROUP", g.code, "|", g.title, "| scopes:", (g.scopes||[]).map((x:any)=>x.scopeLabel+"["+x.availability+"]").join(" ; ").slice(0,400));
}
const my: any = await s.page.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
console.log("MY CLAIM", JSON.stringify(my).slice(0, 600));
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
