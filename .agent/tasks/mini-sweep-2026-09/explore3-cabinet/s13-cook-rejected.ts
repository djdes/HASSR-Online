import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const CID = "cmuax9enx0006209m12tf4w4b";
const u = await db.user.findMany({ where: { organizationId: "e2e-org-a" }, select: { id: true, name: true, email: true, role: true, phone: true, isActive: true } });
console.log("USERS", JSON.stringify(u, null, 1));
const c = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
await go(c.page, c.base + "/mini/claim/" + CID, 3000);
await c.page.waitForFunction(`/переделку|Возьми термометр/.test(document.body.innerText)`, { timeout: 120000 }).catch(()=>console.log("NO LOAD"));
await c.page.waitForTimeout(1500);
console.log("COOK BODY:\n" + (await probe(c.page)).bodyText.slice(0, 1500));
await shot(c.page, "13-cook-rejected", true);
await shot(c.page, "13-cook-rejected-vp");
console.log("VALUES", JSON.stringify(await c.page.evaluate(`[...document.querySelectorAll('input')].map(e=>e.type+'|'+(e.placeholder||'')+'|'+JSON.stringify(e.value)+'|checked='+e.checked)`), null, 1));
console.log("ERRORS", JSON.stringify(c.errors));
await c.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
