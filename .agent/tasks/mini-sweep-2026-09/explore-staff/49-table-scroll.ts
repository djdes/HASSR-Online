import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(10000);
  await p.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>/^Таблица$/.test((e.innerText||'').trim())); e&&e.click()})()`);
  await p.waitForTimeout(5000);
  console.log("doc scrollWidth", await p.evaluate(`document.documentElement.scrollWidth`), "innerW", await p.evaluate(`innerWidth`), "bodySW", await p.evaluate(`document.body.scrollWidth`));
  await shot(p, "table390-before");
  // try window horizontal scroll
  await p.evaluate(`window.scrollTo(400, scrollY)`); await p.waitForTimeout(800);
  console.log("window scrollX after", await p.evaluate(`scrollX`));
  // try touch drag on the table
  const cdp = await p.context().newCDPSession(p);
  const y = 600;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 330, y }] });
  for (const x of [300, 250, 190, 120, 70]) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }); await p.waitForTimeout(70); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(1500);
  console.log("after touch: scrollX", await p.evaluate(`scrollX`), "| scrollers", await p.evaluate(`[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+20&&e.clientWidth>200).map(e=>e.scrollLeft).join(',')`));
  await shot(p, "table390-after-swipe");
  // measure visible right edge of table
  console.log("table rect", await p.evaluate(`(()=>{const t=document.querySelector('table')||document.querySelector('.hygiene-sheet');if(!t)return 'none';const r=t.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x),w:Math.round(r.width),right:Math.round(r.right)})})()`));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
