import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { clickText, doubleClickText, listButtons } from "./dbl";
import { db } from "../tg-session";
const TAG = "ZZ6D" + Date.now().toString().slice(-5);
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
async function open(url: string, waitText: string) { await go(p, s.base + url, 5000); await p.waitForFunction(`/${waitText}/.test(document.body.innerText)`, { timeout: 180000 }); await p.waitForTimeout(2500); }
// Продукт
await open("/settings/products", "Добавить продукт");
await clickText(p, "Добавить продукт"); await p.waitForTimeout(1500);
await p.fill('input[placeholder="Молоко 3.2%"]', TAG + " продукт");
console.log("prod dbl:", await doubleClickText(p, "Создать"));
await p.waitForTimeout(4000);
console.log("PRODUCT rows:", await db.product.count({ where: { organizationId: "e2e-org-a", name: { contains: TAG } } }));
// Оборудование
await open("/settings/equipment", "Добавить оборудование");
await clickText(p, "Добавить оборудование"); await p.waitForTimeout(1500);
await p.fill('input[placeholder="Например: Холодильник Samsung"]', TAG + " обор");
console.log("equip btns", JSON.stringify((await listButtons(p)).slice(-5)));
console.log("equip dbl:", await doubleClickText(p, "Создать"));
await p.waitForTimeout(4000);
console.log("EQUIP rows:", await db.equipment.count({ where: { area: { organizationId: "e2e-org-a" }, name: { contains: TAG } } }));
// Потеря
await open("/losses", "Записать потерю");
await clickText(p, "Записать потерю"); await p.waitForTimeout(1800);
console.log("LOSS FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,900));
console.log("LOSS BTNS", JSON.stringify((await listButtons(p)).slice(-8)));
await shot(p, "49-loss-dialog");
// Изменение
await open("/changes", "Новое изменение");
await clickText(p, "Новое изменение"); await p.waitForTimeout(1800);
console.log("CHANGE FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,900));
console.log("CHANGE BTNS", JSON.stringify((await listButtons(p)).slice(-8)));
await shot(p, "49-change-dialog");
// Партия
await open("/batches", "Новая партия");
await clickText(p, "Новая партия"); await p.waitForTimeout(1800);
console.log("BATCH FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,900));
console.log("BATCH BTNS", JSON.stringify((await listButtons(p)).slice(-8)));
await shot(p, "49-batch-dialog");
console.log("TAG", TAG);
console.log("ERRORS", JSON.stringify(s.errors).slice(0,500));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
