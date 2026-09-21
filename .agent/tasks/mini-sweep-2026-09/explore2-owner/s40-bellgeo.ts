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
      const out=[];
      const walk=(el)=>{ for(const c of el.children){ if((c.innerText||'').includes('Прочитанные')) { const rr=c.getBoundingClientRect(); const cs=getComputedStyle(c); out.push({tag:c.tagName, cls:String(c.className).slice(0,70), pos:cs.position, z:cs.zIndex, op:cs.opacity, vis:cs.visibility, disp:cs.display, t:Math.round(rr.top), l:Math.round(rr.left), w:Math.round(rr.width), h:Math.round(rr.height)}); walk(c);} } };
      walk(document.body);
      return { win:{w:innerWidth,h:innerHeight}, scrollY: scrollY, chain: out.slice(-6) };
    })()`);
    console.log("PANEL-CHAIN", JSON.stringify(r, null, 1));
    await shot(page, "40-bell-full", true);
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();
