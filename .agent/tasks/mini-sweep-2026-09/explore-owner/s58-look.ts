import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(`${s.base}/journals/cold_equipment_control/documents/cmu8hkgnh001tic9md21uf2nx`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(14000);
const pr: any = await probe(p);
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,900));
console.log("fields " + JSON.stringify(await p.evaluate(FIELDS)));
console.log("btns " + JSON.stringify((await p.evaluate(CLICKABLES) as string[]).filter(x=>x.startsWith("B "))).slice(0,1500));
await shot(p, "look1", true);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
