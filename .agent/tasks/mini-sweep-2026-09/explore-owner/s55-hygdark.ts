import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 390, height: 844, theme: "dark" });
const p = s.page;
await p.goto(`${s.base}/journals/hygiene/documents/cmu45uyxc004k5k9m0bq4vwux`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(13000);
await p.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
await p.waitForTimeout(1200);
await shot(p, "hygdark1");
console.log(await p.evaluate(`(()=>{const out=[];for(const e of document.querySelectorAll('*')){if(e.children.length===0&&/Мария|Иван Повар|Ольга/.test(e.innerText||'')){const cs=getComputedStyle(e); let q=e,bg='';while(q){const c=getComputedStyle(q).backgroundColor; if(c&&c.indexOf('rgba(0, 0, 0, 0)')<0){bg=c+' <'+q.tagName+'.'+String(q.className||'').slice(0,50)+'>';break;} q=q.parentElement;} out.push(e.innerText.slice(0,25)+' fg='+cs.color+' bg='+bg);}} return out;})()`));
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
