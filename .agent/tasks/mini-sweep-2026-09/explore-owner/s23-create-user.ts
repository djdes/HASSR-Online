import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
const STAMP = Date.now().toString().slice(-5);
const POS = "ZZ Кондитер " + STAMP;
const NAME = "ZZ Пётр Тестов " + STAMP;
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method() !== "GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,200)); });
await p.goto(s.base + "/settings/users", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
await p.locator('button:has-text("Должность")').first().click();
await p.waitForTimeout(2000);
await p.locator('input[placeholder*="Повар холодного"]').fill(POS);
await p.waitForTimeout(400);
await p.locator('button:has-text("Добавить")').last().click();
await p.waitForTimeout(4000);
await shot(p, "u3-step2");
console.log("step2 fields " + JSON.stringify(await p.evaluate(FIELDS)));
const pr: any = await probe(p);
console.log("step2 text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(0,40).join(" / ").slice(0,900));
console.log("step2 clicks " + JSON.stringify(await p.evaluate(CLICKABLES)).slice(-1200));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
