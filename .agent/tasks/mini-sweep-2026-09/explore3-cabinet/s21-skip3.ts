import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const o = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
await go(o.page, o.base + "/settings/journals/health_check/scope", 4000);
await o.page.waitForFunction(`/Кнопка «Не требуется сегодня»/.test(document.body.innerText)`, { timeout: 120000 });
await o.page.waitForTimeout(2500);
const before = await o.page.evaluate(`[...document.querySelectorAll('[role=switch],button[aria-checked]')].map(e=>e.getAttribute('aria-checked')+' @'+Math.round(e.getBoundingClientRect().top))`);
console.log("switches", JSON.stringify(before));
await o.page.evaluate(`(()=>{const s=[...document.querySelectorAll('[role=switch],button[aria-checked]')];s[0].click();})()`);
await o.page.waitForTimeout(700);
console.log("after click", JSON.stringify(await o.page.evaluate(`[...document.querySelectorAll('[role=switch],button[aria-checked]')].map(e=>e.getAttribute('aria-checked'))`)));
await shot(o.page, "21-toggle-off", true);
await o.page.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Сохранить').click()`);
await o.page.waitForTimeout(3500);
console.log("DB:", JSON.stringify(await db.journalTemplate.findUnique({ where: { code: "health_check" }, select: { allowNoEvents: true } })));
console.log("page tail:", (await probe(o.page)).bodyText.slice(-400).replace(/\n/g," | "));
await o.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
