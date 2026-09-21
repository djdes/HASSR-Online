import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { clickText, doubleClickText, listButtons } from "./dbl";
import { db } from "../tg-session";
const TAG = "ZZ6-DBL-" + Date.now().toString().slice(-6);
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
// --- 1. Нарушение (CAPA)
await go(p, s.base + "/capa", 5000);
await p.waitForFunction(`/Новое нарушение/.test(document.body.innerText)`, { timeout: 180000 });
await p.waitForTimeout(2500);
await clickText(p, "Новое нарушение"); await p.waitForTimeout(1800);
await p.fill('input[name="title"]', TAG + " нарушение");
console.log("capa dbl:", await doubleClickText(p, "Создать нарушение"));
await p.waitForTimeout(4000);
console.log("CAPA rows:", await db.capaTicket.count({ where: { organizationId: "e2e-org-a", title: { contains: TAG } } }));
// --- 2. Цех
await go(p, s.base + "/settings/areas", 5000);
await p.waitForFunction(`/Добавить цех/.test(document.body.innerText)`, { timeout: 180000 });
await p.waitForTimeout(2500);
await clickText(p, "Добавить цех"); await p.waitForTimeout(1800);
console.log("AREA FIELDS", JSON.stringify(await p.evaluate(FIELDS)));
console.log("AREA BTNS", JSON.stringify((await listButtons(p)).slice(-8)));
await s.close(); await db.$disconnect();
console.log("TAG", TAG);
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
