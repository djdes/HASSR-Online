import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
// 1) ownerA выключает пропуск для health_check через UI
const o = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
await go(o.page, o.base + "/settings/journals/health_check/scope", 4000);
await o.page.waitForTimeout(6000);
console.log("SCOPE PAGE:\n" + (await probe(o.page)).bodyText.slice(0, 1800));
await shot(o.page, "19-scope-page", true);
console.log("CLICK", JSON.stringify(await o.page.evaluate(CLICKABLES), null, 1).slice(0,1800));
await o.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
