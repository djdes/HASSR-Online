import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const BELL = String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Уведомления'||/lucide-bell/.test(b.innerHTML));return b?(b.click(),'клик'):'нет';})()`;
(async () => {
  for (const theme of ["light", "dark"] as const) {
    const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme });
    const p = s.page;
    // контроль: прокрутка на /mini/sections без колокольчика
    await p.goto(s.base + "/mini/sections", { timeout: 300000 }); await sleep(p, 7000);
    const ctrl = await p.evaluate(`(()=>{window.scrollTo(0,400);return {y:window.scrollY,h:document.documentElement.scrollHeight,vh:innerHeight,ov:getComputedStyle(document.body).overflow};})()`);
    console.log(`[${theme}] контроль прокрутки /mini/sections:`, JSON.stringify(ctrl));
    // теперь: today → колокольчик → переход в sections
    await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 6000);
    console.log(`[${theme}] колокольчик:`, await p.evaluate(BELL)); await sleep(p, 2500);
    await shot(p, `34-bell-${theme}`);
    const panel = await p.evaluate(String.raw`(()=>{const e=[...document.querySelectorAll('div')].find(d=>/Нет новых уведомлений|Уведомления/.test(d.innerText)&&d.getBoundingClientRect().width<340&&d.getBoundingClientRect().width>150);if(!e)return 'панель не найдена';const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return {bg:cs.backgroundColor,color:cs.color,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cls:(e.className+'').slice(0,80)};})()`);
    console.log(`[${theme}] панель уведомлений:`, JSON.stringify(panel));
    await p.evaluate(`(()=>{const a=document.querySelector('a[href="/mini/sections"]');a&&a.click();})()`);
    await sleep(p, 6000);
    const after = await p.evaluate(`(()=>{window.scrollTo(0,400);return {url:location.pathname,y:window.scrollY,h:document.documentElement.scrollHeight,vh:innerHeight,ov:getComputedStyle(document.body).overflow,panelVisible:!!document.body.innerText.match(/Нет новых уведомлений/)};})()`);
    console.log(`[${theme}] после колокольчика и перехода:`, JSON.stringify(after));
    await shot(p, `34-after-bell-${theme}`);
    console.log(`[${theme}] ERRORS`, JSON.stringify(s.errors.slice(0,5)));
    await s.close();
  }
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
