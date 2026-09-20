import fs from "node:fs";
import path from "node:path";
export const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-owner";
fs.mkdirSync(SHOT, { recursive: true });
export const shotPath = (n: string) => path.join(SHOT, n.endsWith(".png") ? n : n + ".png");
export async function shot(page: any, name: string, full = false) {
  const p = shotPath(name);
  await page.screenshot({ path: p, fullPage: full });
  return p;
}
export const PROBE = `(() => {
  const nl = String.fromCharCode(10);
  const heads = [...document.querySelectorAll('header')].map(e=>e.innerText.split(nl).join(' | ').slice(0,200));
  const navs = [...document.querySelectorAll('nav a')].map(a=>a.innerText.split(nl).join(' ').trim()+ (a.getAttribute('aria-current')?'*':'') + '->' + a.getAttribute('href')).slice(0,30);
  const de = document.documentElement;
  const overflow = de.scrollWidth - de.clientWidth;
  const wide = [...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && (r.right > window.innerWidth+2 || r.left < -2);}).slice(0,12).map(e=>e.tagName+'.'+((e.className&&e.className.toString)?e.className.toString().slice(0,70):'')+' L='+Math.round(e.getBoundingClientRect().left)+' R='+Math.round(e.getBoundingClientRect().right));
  return { url: location.pathname + location.search, title: document.title, heads, navs, overflow, wide, bodyText: document.body.innerText.slice(0,2000) };
})()`;
export async function probe(page: any) { return await page.evaluate(PROBE); }

export const CLICKABLES = `(() => {
  const nl = String.fromCharCode(10);
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button], summary')) {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    const t = (el.innerText||el.getAttribute('aria-label')||'').split(nl).join(' ').trim().slice(0,60);
    out.push((el.tagName==='A'?'A ':'B ') + JSON.stringify(t) + (el.getAttribute('href')?(' ->'+el.getAttribute('href')):'') + ' @' + Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height));
  }
  return out;
})()`;
export const FIELDS = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const r = el.getBoundingClientRect(); if (r.width<3&&r.height<3) continue;
    out.push(el.tagName + '[' + (el.type||'') + '] name=' + (el.name||'') + ' ph=' + (el.getAttribute('placeholder')||'') + ' val=' + JSON.stringify(String(el.value).slice(0,40)) + ' @' + Math.round(r.left)+','+Math.round(r.top));
  }
  return out;
})()`;
