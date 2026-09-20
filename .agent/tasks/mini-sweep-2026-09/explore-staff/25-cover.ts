import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const DOC = "cmu3xjc390004ks9mroi7qi9i";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/journals/hygiene/documents/" + DOC, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(11000);
  const res = await p.evaluate(`(()=>{
    const out=[];
    const rows=[...document.querySelectorAll('[data-day-row]')];
    for (const r of rows){
      const b=[...r.querySelectorAll('button')].pop();
      if(!b) continue;
      const bb=b.getBoundingClientRect();
      const cx=bb.x+bb.width/2, cy=bb.y+bb.height/2;
      const top=document.elementFromPoint(cx,cy);
      out.push({row:(r.innerText||'').replace(/\s+/g,' ').slice(0,28), y:Math.round(bb.y), covered: !(b===top||b.contains(top)), topEl: top? top.tagName+'|'+(top.innerText||'').replace(/\s+/g,' ').slice(0,25):'null'});
    }
    return out;
  })()`);
  console.log("AT SCROLL 0", JSON.stringify(res, null, 1));
  await p.evaluate(`window.scrollTo(0,200)`); await p.waitForTimeout(800);
  const res2 = await p.evaluate(`(()=>{const out=[];for(const r of document.querySelectorAll('[data-day-row]')){const b=[...r.querySelectorAll('button')].pop();if(!b)continue;const bb=b.getBoundingClientRect();const t=document.elementFromPoint(bb.x+bb.width/2,bb.y+bb.height/2);out.push({row:(r.innerText||'').replace(/\s+/g,' ').slice(0,28),y:Math.round(bb.y),covered:!(b===t||b.contains(t)),topEl:t?t.tagName+'|'+(t.innerText||'').replace(/\s+/g,' ').slice(0,25):'null'})}return out})()`);
  console.log("AT SCROLL 200", JSON.stringify(res2, null, 1));
  await shot(p, "cover-scroll200");
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 500)); process.exit(1); });
