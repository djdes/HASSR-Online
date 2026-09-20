import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(s.base + "/mini/sections", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(9000);
const pr: any = await probe(p);
console.log("TEXT:\n" + pr.bodyText);
const links: string[] = await p.evaluate(`(()=>[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')+' :: '+a.innerText.split(String.fromCharCode(10)).join(' / ').trim().slice(0,60)))()`);
console.log("LINKS:\n" + links.join("\n"));
await shot(p, "sec-full", true);
// search
const inp = p.locator('input').first();
if (await inp.count()) {
  await inp.fill("парт");
  await p.waitForTimeout(1500);
  const pr2: any = await probe(p);
  console.log("SEARCH 'парт': " + pr2.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,600));
  await shot(p, "sec-search1");
  await inp.fill("уборк");
  await p.waitForTimeout(1500);
  const pr3: any = await probe(p);
  console.log("SEARCH 'уборк': " + pr3.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,600));
  await shot(p, "sec-search2");
  await inp.fill("ззз");
  await p.waitForTimeout(1500);
  const pr4: any = await probe(p);
  console.log("SEARCH 'ззз': " + pr4.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,600));
  await shot(p, "sec-search3");
} else console.log("NO SEARCH INPUT");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
