import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(10000);
  // Таблица tab
  console.log("TABS", await p.evaluate(`[...document.querySelectorAll('button,a,[role=tab]')].filter(e=>/Сегодня|По сотрудникам|Таблица/.test(e.innerText||'')).map(e=>e.tagName+':'+(e.innerText||'').replace(/\s+/g,' ').trim()+':'+(e.getAttribute('role')||''))`));
  await p.evaluate(`(()=>{const e=[...document.querySelectorAll('button,a,div[role]')].find(e=>/^Таблица$/.test((e.innerText||'').trim())); e&&e.click()})()`);
  await p.waitForTimeout(5000);
  await shot(p, "tab-table-390");
  console.log("TXT", (await T(p)).slice(0, 500));
  const sc: any = await p.evaluate(`(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+20&&e.clientWidth>200);return els.map(e=>({cls:(e.className+'').slice(0,50),sw:e.scrollWidth,cw:e.clientWidth}))})()`);
  console.log("SCROLLERS", JSON.stringify(sc));
  // touch scroll horizontally
  const cdp = await p.context().newCDPSession(p);
  const box = await p.evaluate(`(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.scrollWidth>e.clientWidth+20&&e.clientWidth>200);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  console.log("scroller box", JSON.stringify(box));
  if (box) {
    const y = (box as any).y + (box as any).h / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y }] });
    for (const x of [260, 200, 140, 90, 60]) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }); await p.waitForTimeout(60); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(1500);
    console.log("scrollLeft after swipe", await p.evaluate(`(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.scrollWidth>e.clientWidth+20&&e.clientWidth>200);return e?e.scrollLeft:'none'})()`));
    await shot(p, "tab-table-swiped");
  }
  // print
  const pdf = await p.evaluate(`(()=>{const a=[...document.querySelectorAll('a')].find(a=>/pdf/.test(a.getAttribute('href')||''));return a?{href:a.getAttribute('href'),target:a.target,dl:a.getAttribute('download')}:null})()`);
  console.log("PDF LINK", JSON.stringify(pdf));
  if (pdf) { const r = await p.request.get(s.base + (pdf as any).href); console.log("pdf status", r.status(), r.headers()["content-type"], (await r.body()).length); }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
