import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
const UID = "cmuagc7we00q8cc9m9xkg98zx";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, `${s.base}/settings/users/${UID}/access`, 7000);
  const geo = await page.evaluate(`(() => {
    const t = document.querySelector('table');
    const out = [];
    let p = t;
    while (p && p !== document.body) { const cs=getComputedStyle(p); out.push(p.tagName+'.'+String(p.className).slice(0,60)+' ox='+cs.overflowX+' sw='+p.scrollWidth+' cw='+p.clientWidth); p=p.parentElement; }
    return { docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth, bodyScrollW: document.body.scrollWidth, chain: out, headers: [...document.querySelectorAll('table th')].map(h=>h.innerText.trim()+' @'+Math.round(h.getBoundingClientRect().left)) };
  })()`);
  console.log("GEO", JSON.stringify(geo, null, 1));
  // попробуем проскроллить по горизонтали
  await page.evaluate(`window.scrollTo(400, 0); (document.scrollingElement||document.documentElement).scrollLeft = 400;`);
  await page.waitForTimeout(400);
  console.log("after scrollLeft", await page.evaluate(`[window.scrollX, (document.scrollingElement||document.documentElement).scrollLeft]`));
  await shot(page, "13-access-scrolled");
  await s.close();
})();
