export const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-staff/";
import type { Page } from "playwright";
export async function shot(page: Page, name: string, full = false) {
  await page.screenshot({ path: SHOT + name + ".png", fullPage: full });
  return SHOT + name + ".png";
}
export const DUMP = String.raw`(()=>{
  const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const t=(e)=>(e.innerText||e.textContent||"").replace(/[ \t\n\r]+/g," ").trim();
  const nav=[...document.querySelectorAll('nav a, nav button, [class*=bottom] a')].filter(vis).map(e=>({tag:e.tagName,txt:t(e).slice(0,40),href:e.getAttribute('href'),cls:(e.className+'').slice(0,90)}));
  const btns=[...document.querySelectorAll('button, a[href], [role=button]')].filter(vis).map(e=>{const r=e.getBoundingClientRect();return {txt:t(e).slice(0,60),href:e.getAttribute('href'),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}).filter(b=>b.txt||b.href);
  return {url:location.pathname+location.search, title:document.title, h:[...document.querySelectorAll('h1,h2')].filter(vis).map(t).slice(0,10), body:t(document.body).slice(0,2500), nav, btns:btns.slice(0,60), scrollH:document.documentElement.scrollHeight, innerH:innerHeight, scrollW:document.documentElement.scrollWidth, innerW:innerWidth};
})()`;
