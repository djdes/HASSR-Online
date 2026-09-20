import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
async function go(u: string, wait = 9000) { await p.goto(s.base + u, { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(wait); }
async function dump(tag: string) {
  const pr: any = await probe(p);
  console.log("--- " + tag + " url=" + pr.url + " head=" + JSON.stringify(pr.heads[0]));
  console.log("  clicks: " + JSON.stringify(await p.evaluate(CLICKABLES), null, 0).slice(0, 2500));
  console.log("  fields: " + JSON.stringify(await p.evaluate(FIELDS), null, 0).slice(0, 1500));
  console.log("  text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,1200));
  await shot(p, tag);
}
await go("/journals/cold_equipment_control");
await dump("c1-journal-list");
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
