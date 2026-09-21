import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { clickText, doubleClickText, listButtons } from "./dbl";
import { db } from "../tg-session";
const TAG = "ZZ6D" + Date.now().toString().slice(-5);
const setv = (sel: string, v: string) => `(()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;const setT=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'no '+${JSON.stringify(sel)};(e.tagName==='TEXTAREA'?setT:set).call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';})()`;
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
async function open(url: string, waitText: string) { await go(p, s.base + url, 5000); await p.waitForFunction(`/${waitText}/.test(document.body.innerText)`, undefined, { timeout: 180000 }); await p.waitForTimeout(2500); }
// Потеря
await open("/losses/new", "Опишите причину потери");
console.log("LOSS BTNS", JSON.stringify(await listButtons(p)));
console.log(await p.evaluate(setv('input[name="productName"]', TAG + " потеря")));
console.log(await p.evaluate(setv('input[name="quantity"]', "2")));
console.log(await p.evaluate(setv('textarea[name="cause"]', "ZZ6 проверка двойного тапа")));
await p.waitForTimeout(400);
const lossBtn = (await listButtons(p)).find(t=>/Записать|Сохранить|Создать/.test(t)) || "Записать потерю";
console.log("loss submit label:", lossBtn, "dbl:", await doubleClickText(p, lossBtn));
await p.waitForTimeout(5000);
console.log("LOSS rows:", await db.lossRecord.count({ where: { organizationId: "e2e-org-a", productName: { contains: TAG } } }));
// Изменение
await open("/changes/new", "Например: Замена поставщика муки");
console.log("CHANGE BTNS", JSON.stringify(await listButtons(p)));
console.log(await p.evaluate(setv('input[name="title"]', TAG + " изменение")));
console.log(await p.evaluate(setv('textarea[name="description"]', "ZZ6 описание")));
await p.waitForTimeout(400);
const chBtn = (await listButtons(p)).find(t=>/Создать|Сохранить|Отправить/.test(t)) || "Создать";
console.log("change submit:", chBtn, "dbl:", await doubleClickText(p, chBtn));
await p.waitForTimeout(5000);
console.log("CHANGE rows:", await db.changeRequest.count({ where: { organizationId: "e2e-org-a", title: { contains: TAG } } }));
console.log("TAG", TAG);
console.log("ERRORS", JSON.stringify(s.errors).slice(0,500));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
