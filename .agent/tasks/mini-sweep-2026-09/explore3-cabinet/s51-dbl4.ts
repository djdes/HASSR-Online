import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { clickText, doubleClickText, listButtons } from "./dbl";
import { db } from "../tg-session";
const TAG = "ZZ6D" + Date.now().toString().slice(-5);
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
async function open(url: string, waitText: string) { await go(p, s.base + url, 5000); await p.waitForFunction(`/${waitText}/.test(document.body.innerText)`, { timeout: 180000 }); await p.waitForTimeout(2500); }
// Партия
await open("/batches/new", "Создать партию");
const f1 = await p.evaluate(FIELDS); console.log("BATCH FIELDS", JSON.stringify(f1));
await p.evaluate(`(()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;const i=[...document.querySelectorAll('input')].filter(e=>e.getBoundingClientRect().width>0);set.call(i[0],${JSON.stringify(TAG+" партия")});i[0].dispatchEvent(new Event('input',{bubbles:true}));const q=i.find(e=>e.type==='number'||/Количество/.test(e.getAttribute('placeholder')||''));if(q){set.call(q,'3');q.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
await p.waitForTimeout(500);
console.log("values", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('input')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.type+'='+e.value)`)));
console.log("batch dbl:", await doubleClickText(p, "Создать партию"));
await p.waitForTimeout(5000);
console.log("BATCH rows:", await db.batch.count({ where: { organizationId: "e2e-org-a", productName: { contains: TAG } } }).catch(async()=> "model?"));
console.log("url now", p.url());
// Потеря
await open("/losses", "Записать потерю");
await clickText(p, "Записать потерю"); await p.waitForTimeout(8000);
console.log("LOSS url", p.url()); console.log("LOSS FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,800));
console.log("LOSS BTNS", JSON.stringify((await listButtons(p)).slice(-6)));
await shot(p, "51-loss", true);
// Изменение
await open("/changes", "Новое изменение");
await clickText(p, "Новое изменение"); await p.waitForTimeout(8000);
console.log("CHANGE url", p.url()); console.log("CHANGE FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,800));
console.log("CHANGE BTNS", JSON.stringify((await listButtons(p)).slice(-6)));
await shot(p, "51-change", true);
console.log("TAG", TAG);
console.log("ERRORS", JSON.stringify(s.errors).slice(0,500));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
