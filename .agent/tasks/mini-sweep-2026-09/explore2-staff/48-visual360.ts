import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const OVER = String.raw`(()=>{const bad=[];document.querySelectorAll('*').forEach(e=>{const r=e.getBoundingClientRect();if(r.width>0&&(r.right>innerWidth+1||r.left<-1)){const t=(e.innerText||'').replace(/\s+/g,' ').slice(0,40);bad.push({tag:e.tagName,cls:(e.className+'').slice(0,50),l:Math.round(r.left),r:Math.round(r.right),t});}});return bad.slice(0,12);})()`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  for (const u of ["/mini/today", "/mini/sections", "/mini/me", "/mini/outbox"]) {
    await p.goto(s.base + u, { timeout: 300000 }); await sleep(p, 7000);
    const o = await p.evaluate(OVER);
    console.log(u, "выезд за 360:", JSON.stringify(o));
    await shot(p, "48-" + u.replace(/\//g, "-"));
  }
  // крупно шапку
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 5000);
  const h = await p.locator("header").first();
  await h.screenshot({ path: "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-staff/48-header.png" }).catch(()=>console.log("нет header"));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
