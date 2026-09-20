import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
const themeOf = async () => await p.evaluate(`(()=>{const sh=document.querySelector('.app-shell'); return (sh&&sh.getAttribute('data-app-theme'))+' | body='+getComputedStyle(document.body).backgroundColor;})()`);
await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
const pr: any = await probe(p);
console.log("me text:\n" + pr.bodyText.slice(0,1800));
console.log("clicks " + JSON.stringify(await p.evaluate(CLICKABLES), null, 0).slice(0,2500));
await shot(p, "me1", true);
console.log("theme now: " + await themeOf());
// switch to dark from /mini/me
await p.locator('button:has-text("Тёмная")').first().click();
await p.waitForTimeout(4000);
console.log("after dark click: " + await themeOf());
await shot(p, "me2-dark");
const dbu: any = await db.user.findUnique({ where: { id: s.user.id }, select: { themePreference: true } as any });
console.log("db themePreference: " + JSON.stringify(dbu));
// go to /settings/appearance and see if it agrees
await p.goto(s.base + "/settings/appearance", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(10000);
const pr2: any = await probe(p);
console.log("appearance theme attr: " + await themeOf());
console.log("appearance text: " + pr2.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,900));
await shot(p, "me3-appearance");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
