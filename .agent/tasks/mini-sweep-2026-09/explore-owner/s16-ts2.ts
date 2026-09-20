import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const DOC = "cmu8hkgnh001tic9md21uf2nx", CODE = "cold_equipment_control";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
await p.locator('button:has-text("Таблица")').first().click();
await p.waitForTimeout(4000);
console.log(await p.evaluate(`(()=>{const w=document.querySelector('.overflow-x-auto'); w.scrollLeft=600; return 'set600 -> '+w.scrollLeft+' sw='+w.scrollWidth+' cw='+w.clientWidth+' ovx='+getComputedStyle(w).overflowX;})()`));
// scroll page so table is in view, then wheel
await p.evaluate(`(()=>{const t=document.querySelector('table'); t.scrollIntoView({block:'center'});})()`);
await p.waitForTimeout(600);
await shot(p, "ts2-scrolled-600");
await p.mouse.move(180, 320);
await p.mouse.wheel(400, 0);
await p.waitForTimeout(800);
console.log(await p.evaluate(`(()=>{const w=document.querySelector('.overflow-x-auto'); return 'after wheel sl='+w.scrollLeft;})()`));
await shot(p, "ts3-after-wheel");
console.log("inputs pos: " + JSON.stringify(await p.evaluate(`(()=>[...document.querySelectorAll('input')].filter(i=>String(i.value||'').trim()).map(i=>{const r=i.getBoundingClientRect();return i.value+' L'+Math.round(r.left);}))()`)));
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
