import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
const hist = async (tag: string) => { const pr: any = await probe(p); console.log(tag + " url=" + pr.url + " head=" + JSON.stringify(pr.heads[0])); };
// chain of navigations via UI
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(8000);
await p.locator('a[href="/mini/sections"]').first().click(); await p.waitForTimeout(5000); await hist("1 sections");
await p.locator('a[href="/batches"]').first().click(); await p.waitForTimeout(9000); await hist("2 batches");
await p.locator('a[href^="/batches/"]').first().click().catch(()=>console.log("no batch link")); await p.waitForTimeout(9000); await hist("3 batch detail");
console.log("--- telegram back x1");
await s.pressTelegramBack(); await p.waitForTimeout(4000); await hist("back1");
console.log("--- telegram back x2");
await s.pressTelegramBack(); await p.waitForTimeout(4000); await hist("back2");
console.log("--- telegram back x3");
await s.pressTelegramBack(); await p.waitForTimeout(4000); await hist("back3");
console.log("--- telegram back x4 (at root?)");
await s.pressTelegramBack(); await p.waitForTimeout(4000); await hist("back4");
// reload on nested page
await p.goto(s.base + "/journals/cold_equipment_control/documents/cmu8hkgnh001tic9md21uf2nx", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(10000);
await p.reload({ waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(9000);
await hist("after reload nested");
await shot(p, "sh1-reload-nested");
// help button
await p.locator('button[aria-label="Помощь и подсказки"], button[aria-label="AI помощник"]').first().click();
await p.waitForTimeout(3500);
const pr: any = await probe(p);
console.log("HELP sheet: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(-25).join(" / ").slice(0,900));
await shot(p, "sh2-help");
console.log("help clicks " + JSON.stringify(await p.evaluate(CLICKABLES)).slice(-900));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
