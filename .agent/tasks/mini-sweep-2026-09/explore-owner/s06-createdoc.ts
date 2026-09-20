import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
const before: any[] = await db.journalDocument.findMany({ where: { organizationId: "e2e-org-a", template: { code: "cold_equipment_control" } }, include:{template:{select:{code:true}}} });
console.log("BEFORE docs:", before.map(d=>d.id+" "+d.dateFrom.toISOString().slice(0,10)+".."+d.dateTo.toISOString().slice(0,10)));
await p.goto(s.base + "/journals/cold_equipment_control", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(9000);
await p.getByRole("button", { name: "Создать документ" }).click();
await p.waitForTimeout(2000);
// set a distinctive title
const inp = p.locator('input[placeholder="Введите название документа"]');
await inp.fill("ZZ Проверка владельца 1");
await p.waitForTimeout(300);
await p.getByRole("button", { name: "Создать" }).click();
await p.waitForTimeout(6000);
console.log("after create url=" + p.url());
const pr: any = await probe(p);
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,900));
await shot(p, "c4-after-create");
const after: any[] = await db.journalDocument.findMany({ where: { organizationId: "e2e-org-a", template: { code: "cold_equipment_control" } }, orderBy:{createdAt:"desc"} });
console.log("AFTER docs:", after.map(d=>d.id+" | "+d.dateFrom.toISOString()+" .. "+d.dateTo.toISOString()+" | resp="+d.responsibleTitle+" | cfg="+JSON.stringify(d.config).slice(0,200)));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
