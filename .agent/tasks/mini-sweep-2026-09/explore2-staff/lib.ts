export const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-staff/";
import type { Page } from "playwright";
export async function shot(page: Page, name: string, full = false) {
  await page.screenshot({ path: SHOT + name + ".png", fullPage: full });
  return SHOT + name + ".png";
}
export const sleep = (p: any, ms: number) => p.waitForTimeout(ms);
export const DUMP = String.raw`(()=>{
  const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const t=(e)=>(e.innerText||e.textContent||"").replace(/[ \t\n\r]+/g," ").trim();
  const btns=[...document.querySelectorAll('button, a[href], [role=button], input, select, textarea')].filter(vis).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,type:e.getAttribute('type'),txt:t(e).slice(0,60),href:e.getAttribute('href'),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});
  return {url:location.pathname+location.search, title:document.title, body:t(document.body).slice(0,3000), btns:btns.slice(0,70), scrollH:document.documentElement.scrollHeight, innerH:innerHeight, scrollW:document.documentElement.scrollWidth, innerW:innerWidth};
})()`;
