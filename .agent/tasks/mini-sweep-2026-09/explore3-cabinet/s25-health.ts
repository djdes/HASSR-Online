import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
const CLICK_SUBMIT = `(()=>{const b=[...document.querySelectorAll('button')].filter(x=>/^Завершить/.test(x.innerText.trim()));b[b.length-1].click();return b[b.length-1].disabled})()`;
(async () => {
const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
const p = s.page;
for (const code of ["hygiene","health_check","cleaning","finished_product","incoming_control","climate_control"]) {
  const r: any = await p.evaluate(`fetch('/api/journal-pipelines/${code}').then(async r=>({s:r.status,b:(await r.text()).slice(0,140)}))`);
  console.log("PIPE", code, r.s, r.b.replace(/\s+/g," "));
}
const my: any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
const cid = my.claim.id; console.log("claim", cid, my.claim.journalCode);
await go(p, s.base + "/mini/claim/" + cid, 3000);
await p.waitForFunction(`/Завершить/.test(document.body.innerText)`, { timeout: 120000 });
await p.waitForTimeout(1500);
console.log("submit disabled?", await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].filter(x=>/^Завершить/.test(x.innerText.trim()));return b[b.length-1].disabled})()`));
await p.evaluate(CLICK_SUBMIT);
await p.waitForTimeout(3000);
console.log("BODY after empty submit:\n" + (await probe(p)).bodyText.slice(0,900));
await shot(p, "25-health-empty", true);
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
