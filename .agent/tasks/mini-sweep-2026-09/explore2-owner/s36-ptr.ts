import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: string, y: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 180, y }] } as any);
  try {
    // 1) pull-to-refresh жестом
    await go(page, s.base + "/dashboard", 9000);
    await page.evaluate(`window.scrollTo(0,0)`);
    await page.waitForTimeout(500);
    await touch("touchStart", 120);
    for (let y = 130; y <= 380; y += 25) { await touch("touchMove", y); await page.waitForTimeout(40); }
    await shot(page, "36-ptr-pulled");
    await touch("touchEnd", 380);
    await page.waitForTimeout(6000);
    await shot(page, "36-ptr-after");
    console.log("URL after PTR", page.url());
    console.log("scrollY", await page.evaluate(`window.scrollY`), "bodyOverflow", await page.evaluate(`getComputedStyle(document.body).overflow`));
    // 2) после PTR открываем окно «Закрыть день»
    await page.getByRole("button", { name: "Закрыть день" }).click();
    await page.waitForTimeout(3500);
    await shot(page, "36-dialog-after-ptr");
    const geo = await page.evaluate(`(() => { const d=[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).position==='fixed'&&e.getBoundingClientRect().height>100).map(e=>{const r=e.getBoundingClientRect(); return String(e.className).slice(0,45)+' t='+Math.round(r.top)+' b='+Math.round(r.bottom);}); return {h:innerHeight, scrollY: scrollY, d}; })()`);
    console.log("DIALOG-GEO-AFTER-PTR", JSON.stringify(geo, null, 1));
    console.log("visible?", await page.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Закрыть день' && x.closest('[class*=z-\\[60\\]]')); return b? JSON.stringify(b.getBoundingClientRect()) : 'not-found';})()`));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
