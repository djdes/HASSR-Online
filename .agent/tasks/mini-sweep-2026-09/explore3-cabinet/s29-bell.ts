import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
for (const theme of ["light","dark"] as const) {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme });
  const p = s.page;
  await go(p, s.base + "/dashboard", 5000);
  await p.waitForTimeout(6000);
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Уведомл/.test(x.getAttribute('aria-label')||'')|| /^\d+$/.test(x.innerText.trim())&&x.getBoundingClientRect().top<60);b&&b.click();})()`);
  await p.waitForTimeout(2000);
  const pr = await probe(p);
  console.log("=== theme", theme, "===");
  console.log(pr.bodyText.slice(0, 1400));
  await shot(p, `29-bell-${theme}-vp`);
  // z-index панели vs нижнее меню
  const z = await p.evaluate(`(()=>{const nav=document.querySelector('nav.mini-nav-rail');const navz=nav?getComputedStyle(nav).zIndex:'none';const panels=[...document.querySelectorAll('div')].filter(d=>/Уведомления/.test(d.innerText)&&d.children.length>0&&getComputedStyle(d).position==='fixed').map(d=>({z:getComputedStyle(d).zIndex,r:JSON.stringify(d.getBoundingClientRect())}));return {navz,panels:panels.slice(0,4)}})()`);
  console.log("Z", JSON.stringify(z));
  console.log("CLICK", JSON.stringify(await p.evaluate(CLICKABLES), null, 1).slice(0,1600));
  await s.close();
}
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
