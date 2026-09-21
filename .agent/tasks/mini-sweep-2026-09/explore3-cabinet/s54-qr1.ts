import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
import { clickText, listButtons } from "./dbl";
(async () => {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/settings/users", 5000);
await p.waitForFunction(`/Сотрудник|Пригласить/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(4000);
const pr = await probe(p);
console.log("overflow", pr.overflow, "wide", JSON.stringify(pr.wide));
console.log(pr.bodyText.slice(0, 1400));
await shot(p, "54-users-vp");
console.log("BTNS", JSON.stringify(await listButtons(p)));
console.log("ERRORS", JSON.stringify(s.errors).slice(0,400));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
