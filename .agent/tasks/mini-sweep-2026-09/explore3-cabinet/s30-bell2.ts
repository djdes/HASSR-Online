import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
for (const theme of ["light","dark"] as const) {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme });
  const p = s.page;
  await go(p, s.base + "/dashboard", 5000);
  await p.waitForTimeout(7000);
  await p.click('button[aria-label="Уведомления"]');
  await p.waitForTimeout(2000);
  console.log("=== theme", theme, "===");
  const pr = await probe(p);
  const i = pr.bodyText.indexOf("Уведомления");
  console.log(pr.bodyText.slice(i, i+900));
  await shot(p, `30-bell-${theme}-vp`);
  const geom = await p.evaluate(`(()=>{const nav=document.querySelector('nav.mini-nav-rail');const panel=[...document.querySelectorAll('div.fixed.inset-0')].pop();const card=panel?panel.querySelector('div'):null;return {nav:nav?{z:getComputedStyle(nav).zIndex,r:nav.getBoundingClientRect().toJSON()}:null, panelZ:panel?getComputedStyle(panel).zIndex:null, cardR:card?card.getBoundingClientRect().toJSON():null, topAtNav: (()=>{const n=document.querySelector('nav.mini-nav-rail');if(!n)return null;const r=n.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);return el?el.tagName+'.'+String(el.className).slice(0,60):null})()}})()`);
  console.log("GEOM", JSON.stringify(geom));
  // Escape
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1000);
  console.log("after Escape open?", await p.evaluate(`document.querySelectorAll('div.fixed.inset-0').length`), JSON.stringify((await probe(p)).bodyText.indexOf("Прочитанные")));
  // снова открыть и тап мимо
  await p.click('button[aria-label="Уведомления"]');
  await p.waitForTimeout(1200);
  await p.mouse.click(180, 30);
  await p.waitForTimeout(1200);
  console.log("after tap-outside idx Прочитанные:", (await probe(p)).bodyText.indexOf("Прочитанные"));
  await s.close();
}
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
