import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  // header buttons
  const hdr: any = await p.evaluate(`[...document.querySelectorAll('header button, header a')].map((b,i)=>({i,a:b.getAttribute('aria-label')||b.getAttribute('title')||(b.innerText||'').slice(0,20),tag:b.tagName}))`);
  console.log("HEADER", JSON.stringify(hdr));
  for (const b of hdr as any[]) {
    if (!b.a) continue;
    await p.evaluate(`document.querySelectorAll('header button, header a')[${b.i}].click()`);
    await p.waitForTimeout(3500);
    console.log("clicked", b.a, "->", p.url().replace(s.base, ""), "|", (await T(p)).slice(-220));
    await shot(p, "hdr-" + String(b.a).replace(/\W+/g, "_").slice(0, 24));
    if (!p.url().includes("/mini/today")) { await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(5000); }
    else { await p.keyboard.press("Escape"); await p.waitForTimeout(1200); }
  }
  // sections cards
  await p.goto(s.base + "/mini/sections", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(6000);
  const cards: any = await p.evaluate(`[...document.querySelectorAll('a[href]')].filter(a=>!a.hasAttribute('data-nav-href')).map(a=>({h:a.getAttribute('href'),t:(a.innerText||'').replace(/\s+/g,' ').trim().slice(0,40)}))`);
  console.log("CARDS", JSON.stringify(cards));
  for (const c of cards as any[]) {
    await p.goto(s.base + c.h, { waitUntil: "load", timeout: 300000 });
    await p.waitForTimeout(7000);
    console.log("card", c.t, c.h, "->", p.url().replace(s.base, ""), "|", (await T(p)).slice(0, 180));
  }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
