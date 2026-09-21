import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/dashboard", 8000);
    await page.getByRole("button", { name: "Уведомления" }).click();
    await page.waitForTimeout(4000);
    const r = await page.evaluate(`(() => {
      const ov=[...document.querySelectorAll('div')].find(d=>/fixed inset-0 z-40/.test(String(d.className)));
      if(!ov) return 'no overlay';
      const out=[]; let p=ov;
      while(p && p!==document.documentElement){ const cs=getComputedStyle(p); const rr=p.getBoundingClientRect();
        out.push(p.tagName+'.'+String(p.className).slice(0,50)+' pos='+cs.position+' of='+cs.overflow+' tr='+cs.transform+' bf='+cs.backdropFilter+' flt='+cs.filter+' ct='+cs.contain+' wc='+cs.willChange+' z='+cs.zIndex+' rect='+Math.round(rr.top)+','+Math.round(rr.height));
        p=p.parentElement; }
      const panel = ov.firstElementChild ? ov.firstElementChild.getBoundingClientRect() : null;
      const mid = panel ? document.elementFromPoint(Math.round(panel.left+panel.width/2), Math.round(panel.top+30)) : null;
      return { chain: out, panel: panel && {t:Math.round(panel.top),l:Math.round(panel.left),w:Math.round(panel.width),h:Math.round(panel.height)}, topAtPanel: mid ? mid.tagName+'.'+String(mid.className).slice(0,60) : null };
    })()`);
    console.log("WHY", JSON.stringify(r, null, 1));
    await page.screenshot({ path: "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-owner/41-top.png", clip: { x: 0, y: 0, width: 360, height: 300 } });
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  await s.close();
})();
