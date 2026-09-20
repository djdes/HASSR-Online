import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const PROBE = `(()=>{const h=document.documentElement;const hdr=document.querySelector('header')||document.querySelector('[class*=MiniTopBar],[class*=top-bar]');
 return {dataTheme:h.getAttribute('data-theme'),appTheme:h.getAttribute('data-app-theme'),cls:h.className.slice(0,60),bodyBg:getComputedStyle(document.body).backgroundColor,bodyColor:getComputedStyle(document.body).color, miniRoot: (()=>{const m=document.getElementById('mini-root');return m? getComputedStyle(m).backgroundColor+' / '+m.getAttribute('data-theme'):'none'})()};})()`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "dark" });
  const p = s.page;
  for (const u of ["/mini/today", "/mini/me", "/mini/sections", "/mini/outbox", "/journals/hygiene", "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", "/settings/balance", "/journals/hygiene/documents/nope"]) {
    await p.goto(s.base + u, { waitUntil: "load", timeout: 300000 });
    await p.waitForTimeout(6000);
    console.log(u, JSON.stringify(await p.evaluate(PROBE)));
    await shot(p, "dk-" + u.replace(/\W+/g, "_").slice(0, 36));
  }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
