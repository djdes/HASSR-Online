import { openTelegramSession } from "../tg-session";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-staff/";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(7000);
  await p.evaluate(`document.body.style.zoom='3'`);
  await p.waitForTimeout(800);
  await p.screenshot({ path: SHOT + "logo-zoom.png", clip: { x: 0, y: 0, width: 360, height: 180 } });
  await p.evaluate(`document.body.style.zoom='1'`);
  console.log("logo el", await p.evaluate(`(()=>{const e=document.querySelector('[role=img][aria-label="WeSetup"],[aria-label="WeSetup"]');if(!e)return 'none';const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),mask:cs.webkitMaskImage||cs.maskImage,color:cs.backgroundColor})})()`));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 500)); process.exit(1); });
