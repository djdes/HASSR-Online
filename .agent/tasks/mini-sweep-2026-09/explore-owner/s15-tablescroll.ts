import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const DOC = "cmu8hkgnh001tic9md21uf2nx", CODE = "cold_equipment_control";
const Q = `(() => {
  const inputs=[...document.querySelectorAll('input')].filter(i=>String(i.value||'').trim());
  const info = inputs.map(i=>{const r=i.getBoundingClientRect(); return i.value+' @L'+Math.round(r.left)+' R'+Math.round(r.right)+' vis='+(r.left>=0&&r.right<=window.innerWidth);});
  const bodyOv = getComputedStyle(document.body).overflowX + '/' + getComputedStyle(document.documentElement).overflowX;
  const wrap = document.querySelector('.overflow-x-auto');
  const wi = wrap ? {cs:getComputedStyle(wrap).overflowX, cw:wrap.clientWidth, sw:wrap.scrollWidth, sl:wrap.scrollLeft} : null;
  return { info, bodyOv, wi, docSW: document.documentElement.scrollWidth, docCW: document.documentElement.clientWidth };
})()`;
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
await p.locator('button:has-text("Таблица")').first().click();
await p.waitForTimeout(4000);
console.log("BEFORE " + JSON.stringify(await p.evaluate(Q), null, 1));
// try a touch swipe to the left over the table area
await p.evaluate(`window.scrollTo(0, 900)`); await p.waitForTimeout(500);
await shot(p, "ts0");
const box = await p.locator('table').first().boundingBox();
console.log("table box", box);
await p.touchscreen.tap(200, 400);
// swipe
for (let i=0;i<3;i++){
  await p.mouse.move(320, 420); await p.mouse.down();
  await p.mouse.move(60, 420, { steps: 12 }); await p.mouse.up();
  await p.waitForTimeout(500);
}
console.log("AFTER SWIPE " + JSON.stringify(await p.evaluate(Q), null, 1));
await shot(p, "ts1-after-swipe");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
