import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
(async () => {
  for (const [w,h,th] of [[390,844,"light"],[360,640,"dark"]] as any[]) {
    const s = await openTelegramSession({ role: "ownerA", width: w, height: h, theme: th });
    const page = s.page;
    try {
      await go(page, s.base + "/dashboard", 8000);
      await page.getByRole("button", { name: "Уведомления" }).click();
      await page.waitForTimeout(4000);
      await shot(page, `42-bell-${w}x${h}-${th}`);
      const r = await page.evaluate(`(() => { const ov=[...document.querySelectorAll('div')].find(d=>/fixed inset-0 z-40/.test(String(d.className))); if(!ov) return 'нет панели в DOM'; const rr=ov.getBoundingClientRect(); const p=ov.firstElementChild.getBoundingClientRect(); const top=document.elementFromPoint(Math.round(p.left+p.width/2), Math.round(p.top+40)); return { overlay: Math.round(rr.width)+'x'+Math.round(rr.height), panel: Math.round(p.width)+'x'+Math.round(p.height)+' @'+Math.round(p.top), elementOnTop: top? top.tagName+'.'+String(top.className).slice(0,50):null, insidePanel: top? ov.contains(top):null }; })()`);
      console.log(`${w}x${h} ${th}`, JSON.stringify(r));
      // а AI-помощник?
      await page.keyboard.press("Escape"); await page.waitForTimeout(800);
      await page.getByRole("button", { name: "ИИ-помощник" }).click().catch(()=>{});
      await page.waitForTimeout(3000);
      await shot(page, `42-ai-${w}x${h}-${th}`);
      console.log("  AI visible?", await page.evaluate(`(() => { const t=document.body.innerText; return /помощник|Спросите|Задайте|ИИ/i.test(t.slice(-500)); })()`));
    } catch (e) { console.log("ERR", String(e).slice(0,250)); }
    await s.close();
  }
})();
