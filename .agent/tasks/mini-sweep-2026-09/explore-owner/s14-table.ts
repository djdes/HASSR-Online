import { openTelegramSession, db } from "../tg-session";
import { shot, probe } from "./lib";
const DOC = "cmu8hkgnh001tic9md21uf2nx", CODE = "cold_equipment_control";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
await p.locator('button:has-text("Таблица")').first().click();
await p.waitForTimeout(4000);
console.log("inputs in table: " + JSON.stringify(await p.evaluate(`(()=>{const out=[];for(const i of document.querySelectorAll('input,textarea')){if(String(i.value||'').trim()) out.push((i.getAttribute('aria-label')||i.name||i.placeholder||'')+'='+i.value);} return out.slice(0,40);})()`)));
console.log("cells with -20/44: " + JSON.stringify(await p.evaluate(`(()=>{const out=[];for(const td of document.querySelectorAll('td,th')){const t=td.innerText.trim(); if(t && /^-?[0-9]+([.,][0-9]+)?$/.test(t)) out.push(t);} return out.slice(0,60);})()`)));
// scrollers
console.log("scrollers: " + JSON.stringify(await p.evaluate(`(()=>{const out=[];for(const e of document.querySelectorAll('*')){if(e.scrollWidth>e.clientWidth+20&&e.clientWidth>100) out.push((e.className||'').toString().slice(0,60)+' cw='+e.clientWidth+' sw='+e.scrollWidth);} return out.slice(0,10);})()`)));
await shot(p, "t1-table");
// scroll the table horizontally to the end
await p.evaluate(`(()=>{for(const e of document.querySelectorAll('*')){if(e.scrollWidth>e.clientWidth+20&&e.clientWidth>100) e.scrollLeft=e.scrollWidth;}})()`);
await p.waitForTimeout(800);
await shot(p, "t2-table-right");
await p.evaluate(`window.scrollTo(0, 700)`);
await p.waitForTimeout(500);
await shot(p, "t3-table-mid");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
