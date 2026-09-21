import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
const DOC = "cmu3xjc390004ks9mroi7qi9i";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    // A) placeholder поиска журналов
    await go(page, s.base + "/dashboard", 9000);
    console.log("PLACEHOLDER", JSON.stringify(await page.evaluate(`[...document.querySelectorAll('input')].map(i=>i.placeholder).filter(Boolean)`)));
    // B) колокольчик
    const bell = await page.evaluate(`(() => { const b=[...document.querySelectorAll('header button')].map((b,i)=>i+':'+(b.getAttribute('aria-label')||b.innerText.trim()||'?')); return b; })()`);
    console.log("HEADER-BUTTONS", JSON.stringify(bell));
    await page.evaluate(`{const bs=[...document.querySelectorAll('header button')]; bs[bs.length-1].click();}`);
    await page.waitForTimeout(4000);
    await shot(page, "38-bell");
    console.log("PANEL", (await page.evaluate(`document.body.innerText`) as string).slice(-800));
    // C) нижняя панель «Заполнить» в гигиене
    await go(page, `${s.base}/journals/hygiene/documents/${DOC}`, 11000);
    await shot(page, "38-hyg-top");
    const bar0 = await page.evaluate(`(() => { const e=[...document.querySelectorAll('*')].filter(x=>getComputedStyle(x).position==='fixed'&&x.getBoundingClientRect().height>30&&x.getBoundingClientRect().top>300).map(x=>{const r=x.getBoundingClientRect(); return String(x.className).slice(0,50)+' t='+Math.round(r.top)+' b='+Math.round(r.bottom)+' :: '+x.innerText.split(String.fromCharCode(10)).join(' ').slice(0,50);}); return e; })()`);
    console.log("FIXED-BEFORE-SCROLL", JSON.stringify(bar0, null, 1));
    await page.evaluate(`window.scrollBy(0, 500)`);
    await page.waitForTimeout(1500);
    await shot(page, "38-hyg-scrolled");
    const bar1 = await page.evaluate(`(() => { const e=[...document.querySelectorAll('*')].filter(x=>getComputedStyle(x).position==='fixed'&&x.getBoundingClientRect().height>30&&x.getBoundingClientRect().top>300).map(x=>{const r=x.getBoundingClientRect(); return String(x.className).slice(0,50)+' t='+Math.round(r.top)+' b='+Math.round(r.bottom)+' :: '+x.innerText.split(String.fromCharCode(10)).join(' ').slice(0,50);}); return e; })()`);
    console.log("FIXED-AFTER-SCROLL", JSON.stringify(bar1, null, 1));
    // до конца списка
    await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await page.waitForTimeout(1500);
    await shot(page, "38-hyg-bottom");
    const tail = await page.evaluate(`(() => { const de=document.documentElement; const last=[...document.querySelectorAll('button,div')].filter(e=>e.getBoundingClientRect().height>10).slice(-1)[0]; const bars=[...document.querySelectorAll('*')].filter(x=>getComputedStyle(x).position==='fixed'&&x.getBoundingClientRect().top>300); const cover = bars.map(b=>{const r=b.getBoundingClientRect(); return Math.round(r.top)+'-'+Math.round(r.bottom);}); return { scrollY: scrollY, maxScroll: de.scrollHeight-innerHeight, bars: cover }; })()`);
    console.log("BOTTOM", JSON.stringify(tail));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
