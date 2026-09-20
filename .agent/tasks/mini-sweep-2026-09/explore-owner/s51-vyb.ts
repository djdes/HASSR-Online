import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(14000);
console.log(await p.evaluate(`(()=>{const out=[];for(const e of document.querySelectorAll('*')){if(e.children.length===0 && e.innerText && e.innerText.trim()==='Выборочно'){let q=e,path=[];while(q&&q!==document.body){path.push(q.tagName+'.'+String(q.className||'').slice(0,40));q=q.parentElement;}out.push(path.join(' < '));}} return out;})()`));
console.log("nested buttons: " + await p.evaluate(`(()=>[...document.querySelectorAll('button button')].map(b=>b.innerText.split(String.fromCharCode(10)).join(' ').slice(0,60)).slice(0,10))()`));
// click Выборочно
await p.locator('text=Выборочно').first().click();
await p.waitForTimeout(4000);
const pr: any = await probe(p);
console.log("after click url=" + pr.url + " first: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(0,20).join(" / ").slice(0,800));
await shot(p, "vyb1");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
