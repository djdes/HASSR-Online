import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const o = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
await go(o.page, o.base + "/settings/journals/health_check/scope", 4000);
await o.page.waitForTimeout(6000);
// первый switch-подобный элемент рядом с заголовком «Кнопка «Не требуется сегодня»»
const r = await o.page.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].filter(x=>x.innerText.trim()===''&&x.getBoundingClientRect().width>30&&x.getBoundingClientRect().height<30);b[0].click();return b.length})()`);
console.log("toggles found", r);
await o.page.waitForTimeout(800);
await shot(o.page, "20-toggled", true);
await o.page.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Сохранить').click()`);
await o.page.waitForTimeout(3000);
console.log("BODY:", (await probe(o.page)).bodyText.slice(0,700).replace(/\n/g," | "));
const t = await db.journalTemplate.findUnique({ where: { code: "health_check" }, select: { allowNoEvents: true } });
console.log("DB health_check allowNoEvents =", t?.allowNoEvents);
console.log("ERRORS", JSON.stringify(o.errors));
await o.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
