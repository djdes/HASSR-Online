import { openTelegramSession, db } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,220)); });
for (const pass of [1,2]) {
  await p.goto(s.base + "/plans/new", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(pass===1?13000:6000);
  await p.locator('input[name="date"]').fill("2026-09-24");
  await p.locator('input[placeholder="SKU / Продукт"]').fill("ZZ Борщ");
  await p.locator('input[placeholder="Кол-во"]').fill("10");
  await p.waitForTimeout(400);
  await p.locator('button:has-text("Создать план")').click();
  await p.waitForTimeout(8000);
  const pr: any = await probe(p);
  console.log("PASS " + pass + " -> url=" + pr.url);
  console.log("   text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,800));
  await shot(p, "pl-pass" + pass);
}
const rows: any[] = await db.productionPlan.findMany({ where: { organizationId: "e2e-org-a" }, orderBy: { createdAt: "desc" }, take: 5 } as any).catch((e:any)=>{console.log("db err "+e.message.slice(0,200)); return [];});
console.log("DB plans: " + JSON.stringify(rows.map((r:any)=>({id:r.id, date:r.date, shift:r.shift})), null, 0));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
