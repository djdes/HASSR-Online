import { openSite } from "./site";
import { go, probe, shot } from "./lib";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/settings/equipment", 5000);
await p.waitForFunction(`/Термогигрометр цеха/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(3000);
await p.click('button[aria-label="Изменить оборудование «Термогигрометр цеха»"]');
await p.waitForTimeout(2500);
console.log("MODAL:\n" + (await probe(p)).bodyText.slice(-700));
console.log("select value:", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('[role=combobox],select,button')].filter(e=>/Холодильник|Морозильник|Датчик|Выберите тип/.test(e.innerText)).map(e=>e.innerText.trim()).slice(0,4)`)));
await shot(p, "90-sensor-modal");
const before = await db.equipment.findUnique({ where: { id: "cmu2stney000ewk9mgygxjc4c" }, select: { type: true } });
console.log("DB type before:", JSON.stringify(before));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
