import fs from "node:fs";
import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
const C = fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09/explore-owner/contrast2.js", "utf8");
const PAIRS = process.env.PAIRS!.split(",").map(x=>x.split("="));
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: (process.env.THEME as any)||"light" });
const p = s.page;
for (const [code, id] of PAIRS) {
  const before = s.errors.length;
  await p.goto(`${s.base}/journals/${code}/documents/${id}`, { waitUntil: "load", timeout: 300000 }).catch(()=>{});
  await p.waitForTimeout(Number(process.env.WAIT||10000));
  const pr: any = await probe(p);
  console.log("### " + code + "  head=" + JSON.stringify(pr.heads[0]) + " overflowX=" + pr.overflow);
  console.log("   text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,1100));
  const cl: string[] = await p.evaluate(CLICKABLES);
  console.log("   btns: " + cl.filter(x=>x.startsWith("B ")).map(x=>x.slice(2).split(" @")[0]).join(", ").slice(0,700));
  const low: string[] = await p.evaluate(C);
  if (low.length) console.log("   LOWCONTRAST: " + low.slice(0,5).join(" | "));
  await shot(p, ((process.env.THEME||"light")==="dark"?"dk":"lt") + "-doc-" + code);
  const e = s.errors.slice(before); if (e.length) console.log("   !! " + JSON.stringify(e.slice(0,4)));
}
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
