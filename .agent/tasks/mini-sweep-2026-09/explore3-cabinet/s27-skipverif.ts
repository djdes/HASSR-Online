import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const t = await db.journalTemplate.findMany({ where: { code: { in: ["complaint_register","hygiene","incoming_control"] } }, select: { code: true, allowNoEvents: true, noEventsReasons: true, allowFreeTextReason: true } });
console.log("TEMPLATES", JSON.stringify(t));
const h = await openTelegramSession({ role: "headA", width: 360, height: 640 });
await go(h.page, h.base + "/verifications", 4000);
await h.page.waitForFunction(`/ЖДУТ ПРОВЕРКИ/i.test(document.body.innerText)`, { timeout: 120000 });
await h.page.waitForTimeout(2500);
await h.page.evaluate(`[...document.querySelectorAll('button')].filter(x=>/Жалоба — записать сегодня/.test(x.innerText))[0].click()`);
await h.page.waitForTimeout(2500);
const b = (await probe(h.page)).bodyText;
const i = b.indexOf("Жалоба — записать сегодня");
console.log("CARD:\n" + b.slice(i, i+1200));
await shot(h.page, "27-skip-verif", true);
console.log("ERRORS", JSON.stringify(h.errors));
await h.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
