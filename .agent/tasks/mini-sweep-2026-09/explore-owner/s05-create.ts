import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
const MODAL = `(() => {
  const nl=String.fromCharCode(10);
  const cands=[...document.querySelectorAll('[role=dialog], [data-state=open], .fixed')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>150&&r.height>100;});
  return cands.slice(0,6).map(e=>{const r=e.getBoundingClientRect(); return {cls:(e.className||'').toString().slice(0,90), rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], vh:window.innerHeight, scrollH:e.scrollHeight, clientH:e.clientHeight, text:e.innerText.split(nl).join(' / ').slice(0,600)};});
})()`;
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(s.base + "/journals/cold_equipment_control", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(9000);
await p.getByRole("button", { name: "Создать документ" }).click();
await p.waitForTimeout(2500);
console.log("MODAL " + JSON.stringify(await p.evaluate(MODAL), null, 1));
console.log("fields " + JSON.stringify(await p.evaluate(FIELDS), null, 1));
console.log("clicks " + JSON.stringify(await p.evaluate(CLICKABLES), null, 1));
await shot(p, "c2-create-modal");
// scroll inside modal to bottom
await p.evaluate(`(()=>{const d=document.querySelector('[role=dialog]'); if(d) d.scrollTop=d.scrollHeight; window.scrollTo(0,document.body.scrollHeight);})()`);
await p.waitForTimeout(600);
await shot(p, "c3-create-modal-bottom");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
