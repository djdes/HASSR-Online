import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const URLS = process.env.URLS!.split(",");
const BOT = `(() => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  return 1;
})()`;
const CHECK = `(() => {
  const nav = document.querySelector('nav');
  let navTop = window.innerHeight;
  // find the fixed bottom nav
  for (const n of document.querySelectorAll('nav')) { const r = n.getBoundingClientRect(); if (r.bottom > window.innerHeight - 90 && r.height > 20 && r.width > window.innerWidth*0.7) navTop = Math.min(navTop, r.top); }
  const hidden = [];
  for (const el of document.querySelectorAll('button, a, input, select, textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (el.closest('nav') || el.closest('header')) continue;
    if (r.top < window.innerHeight && r.bottom > navTop + 2) hidden.push((el.innerText||el.getAttribute('placeholder')||el.tagName).split(String.fromCharCode(10)).join(' ').trim().slice(0,50) + ' [top=' + Math.round(r.top) + ' bot=' + Math.round(r.bottom) + ']');
  }
  const small = [];
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const r = el.getBoundingClientRect();
    if (r.height>4 && fs < 16) small.push((el.getAttribute('placeholder')||el.name||el.type) + ' fs=' + fs);
  }
  return { navTop, scrollH: document.documentElement.scrollHeight, scrollY: Math.round(window.scrollY), hidden: hidden.slice(0,10), small: small.slice(0,10) };
})()`;
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: (process.env.THEME as any)||"light" });
for (const u of URLS) {
  try { await s.page.goto(s.base + u, { waitUntil: "load", timeout: 300000 }); } catch(e) { console.log("### "+u+" ERR"); continue; }
  await s.page.waitForTimeout(Number(process.env.WAIT||7000));
  await s.page.evaluate(BOT); await s.page.waitForTimeout(900);
  const r: any = await s.page.evaluate(CHECK);
  await shot(s.page, "bot-" + u.replace(/[^a-z0-9]/gi,"_"));
  console.log("### " + u + " scrollH=" + r.scrollH + " navTop=" + r.navTop);
  if (r.hidden.length) console.log("   UNDER-NAV: " + JSON.stringify(r.hidden));
  if (r.small.length) console.log("   SMALL-FONT: " + JSON.stringify(r.small));
}
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
