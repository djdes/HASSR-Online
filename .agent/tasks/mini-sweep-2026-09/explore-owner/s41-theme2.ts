import { openTelegramSession, db } from "../tg-session";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
const LS = `(()=>{const o={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(/theme/i.test(k)) o[k]=localStorage.getItem(k);} const sh=document.querySelector('.app-shell'); return {ls:o, attr: sh?sh.getAttribute('data-app-theme'):null};})()`;
await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(11000);
console.log("before: " + JSON.stringify(await p.evaluate(LS)));
await p.locator('button:has-text("Тёмная")').first().click(); await p.waitForTimeout(4000);
console.log("after mini switch: " + JSON.stringify(await p.evaluate(LS)));
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(9000);
console.log("on /dashboard: " + JSON.stringify(await p.evaluate(LS)));
console.log("db=" + JSON.stringify(await db.user.findUnique({ where: { id: s.user.id }, select: { themePreference: true } as any })));
// now switch to dark via /settings/appearance and check /mini/me
await p.goto(s.base + "/settings/appearance", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(9000);
await p.locator('button:has-text("Тёмная")').first().click(); await p.waitForTimeout(4000);
console.log("after appearance switch: " + JSON.stringify(await p.evaluate(LS)));
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(9000);
console.log("dashboard after appearance switch: " + JSON.stringify(await p.evaluate(LS)));
await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(8000);
console.log("mini/me after appearance switch: " + JSON.stringify(await p.evaluate(LS)));
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
