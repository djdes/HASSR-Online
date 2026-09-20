import { openTelegramSession, db } from "../tg-session";
import { shot, probe } from "./lib";
const DOC = "cmu45uyxc004k5k9m0bq4vwux", CODE = "hygiene";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"")); });
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(13000);
// scroll to bottom, measure Ольга card vs sticky bar
await p.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
await p.waitForTimeout(1000);
console.log(await p.evaluate(`(()=>{
  const bar=[...document.querySelectorAll('button')].find(b=>b.innerText.indexOf('Заполнить оставшиеся')>=0);
  const br=bar?bar.getBoundingClientRect():null;
  const out=[];
  for(const b of document.querySelectorAll('button')){ if(b.innerText.trim()==='Заполнить'){const r=b.getBoundingClientRect(); out.push('Заполнить top='+Math.round(r.top)+' bot='+Math.round(r.bottom)+' coveredByBar='+(br? (r.bottom>br.top && r.top<br.bottom):false));}}
  return {scrollY:Math.round(scrollY), maxScroll: document.documentElement.scrollHeight-innerHeight, bar: br?{t:Math.round(br.top),b:Math.round(br.bottom)}:null, buttons: out, vh: innerHeight};
})()`));
await shot(p, "hy3-bottom");
console.log("--- click first Заполнить (Мария)");
await p.evaluate(`window.scrollTo(0,0)`); await p.waitForTimeout(800);
await p.locator('button:has-text("Заполнить")').first().click({ force: true });
await p.waitForTimeout(5000);
await shot(p, "hy4-after-click");
const pr: any = await probe(p);
console.log("url=" + pr.url);
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,900));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
