import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { clickText, doubleClickText, listButtons } from "./dbl";
import { db } from "../tg-session";
const TAG = "ZZ6D" + Date.now().toString().slice(-5);
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
async function open(url: string, waitText: string) { await go(p, s.base + url, 5000); await p.waitForFunction(`/${waitText}/.test(document.body.innerText)`, { timeout: 180000 }); await p.waitForTimeout(2500); }
// --- Цех
await open("/settings/areas", "Добавить цех");
await clickText(p, "Добавить цех"); await p.waitForTimeout(1500);
await p.fill('input[placeholder="Например: Цех №1"]', TAG + " цех");
console.log("area dbl:", await doubleClickText(p, "Создать"));
await p.waitForTimeout(4000);
console.log("AREA rows:", await db.area.count({ where: { organizationId: "e2e-org-a", name: { contains: TAG } } }));
// --- Продукт
await open("/settings/products", "Добавить продукт");
await clickText(p, "Добавить продукт"); await p.waitForTimeout(1500);
console.log("PROD FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,600));
console.log("PROD BTNS", JSON.stringify((await listButtons(p)).slice(-6)));
const ph = await p.evaluate(`(()=>{const i=[...document.querySelectorAll('input[type=text]')].filter(e=>e.getBoundingClientRect().width>0);return i.length?i[0].placeholder:null})()`);
await p.fill(`input[placeholder=${JSON.stringify(ph)}]`, TAG + " продукт");
console.log("prod dbl:", await doubleClickText(p, "Создать"));
await p.waitForTimeout(4000);
console.log("PRODUCT rows:", await db.product.count({ where: { organizationId: "e2e-org-a", name: { contains: TAG } } }));
// --- Оборудование
await open("/settings/equipment", "Добавить оборудование");
await clickText(p, "Добавить оборудование"); await p.waitForTimeout(1500);
await p.fill('input[placeholder="Например: Холодильник Samsung"]', TAG + " обор");
console.log("equip dbl:", await doubleClickText(p, "Создать"));
await p.waitForTimeout(4000);
console.log("EQUIP rows:", await db.equipment.count({ where: { area: { organizationId: "e2e-org-a" }, name: { contains: TAG } } }));
// --- Потеря
await open("/losses", "Записать потерю");
await clickText(p, "Записать потерю"); await p.waitForTimeout(1800);
console.log("LOSS FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,900));
console.log("LOSS BTNS", JSON.stringify((await listButtons(p)).slice(-8)));
await shot(p, "48-loss-dialog");
// --- Изменение
await open("/changes", "Новое изменение");
await clickText(p, "Новое изменение"); await p.waitForTimeout(1800);
console.log("CHANGE FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,900));
console.log("CHANGE BTNS", JSON.stringify((await listButtons(p)).slice(-8)));
await shot(p, "48-change-dialog");
console.log("TAG", TAG);
console.log("ERRORS", JSON.stringify(s.errors).slice(0,500));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
