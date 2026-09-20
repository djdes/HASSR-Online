import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "dark" });
  const p = s.page;
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(10000);
  await p.evaluate(`(()=>{const r=[...document.querySelectorAll('[data-day-row]')].find(r=>/Ольга/.test(r.innerText)); r&&r.scrollIntoView({block:'center'})})()`);
  await p.waitForTimeout(1000);
  await shot(p, "myrow-dark");
  console.log(JSON.stringify(await p.evaluate(`(()=>{const r=[...document.querySelectorAll('[data-day-row]')].find(r=>/Ольга/.test(r.innerText));const out=[];for(const e of r.querySelectorAll('*')){if(e.children.length)continue;const cs=getComputedStyle(e);let n=e,bg='';while(n){const b=getComputedStyle(n).backgroundColor;if(b&&b!=='rgba(0, 0, 0, 0)'){bg=b;break}n=n.parentElement}out.push({t:(e.innerText||'').slice(0,25),color:cs.color,bg})}return out})()`), null, 1));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 500)); process.exit(1); });
