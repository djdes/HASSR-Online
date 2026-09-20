import { openTelegramSession, db } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,220)); });
await p.goto(s.base + "/capa/new", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(13000);
const read = async () => await p.evaluate(`(()=>[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(t=>t.indexOf(String.fromCharCode(1095))>=0))()`);
console.log("defaults: " + JSON.stringify(await read()));
await p.locator('button:has-text("Средний (48ч)")').click(); await p.waitForTimeout(1200);
await p.locator('[role="option"]:has-text("Критический")').click(); await p.waitForTimeout(1500);
console.log("after priority=Критический: " + JSON.stringify(await read()));
await shot(p, "capa2-priority");
await p.locator('input[name="title"]').fill("ZZ Отклонение тест");
await p.locator('textarea[name="description"]').fill("ZZ описание отклонения для проверки");
await p.locator('button:has-text("Создать CAPA")').click();
await p.waitForTimeout(9000);
const pr: any = await probe(p);
console.log("after create url=" + pr.url);
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,1200));
await shot(p, "capa3-created", true);
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
