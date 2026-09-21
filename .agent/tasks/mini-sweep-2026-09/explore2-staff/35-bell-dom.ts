import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const BELL = String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Уведомления'||/lucide-bell/.test(b.innerHTML));return b?(b.click(),'клик'):'нет';})()`;
const PROBE = String.raw`(()=>{
  const out=[];
  document.querySelectorAll('div').forEach(e=>{
    const c=e.className+'';
    if(/fixed inset-0 z-40/.test(c)||/rounded-3xl/.test(c)&&/bg-white/.test(c)&&/flex-col/.test(c)){
      const r=e.getBoundingClientRect();const cs=getComputedStyle(e);
      out.push({cls:c.slice(0,90),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bg:cs.backgroundColor,z:cs.zIndex,pos:cs.position,op:cs.opacity,vis:cs.visibility});
    }
  });
  // ищем предков с transform/filter
  const panel=[...document.querySelectorAll('div')].find(e=>/fixed inset-0 z-40/.test(e.className+''));
  const anc=[];let n=panel&&panel.parentElement;
  while(n&&n!==document.documentElement){const cs=getComputedStyle(n);if(cs.transform!=='none'||cs.filter!=='none'||cs.perspective!=='none'||cs.contain!=='none'||cs.overflow!=='visible')anc.push({tag:n.tagName,cls:(n.className+'').slice(0,60),tr:cs.transform.slice(0,30),f:cs.filter,ov:cs.overflow,contain:cs.contain});n=n.parentElement;}
  return {out,anc};
})()`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 7000);
  console.log(await p.evaluate(BELL)); await sleep(p, 2500);
  console.log(JSON.stringify(await p.evaluate(PROBE), null, 1));
  await shot(p, "35-bell-dom");
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
