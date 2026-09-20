import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
const T = async () => await p.evaluate(`(()=>{const sh=document.querySelector('.app-shell'); return (sh?sh.getAttribute('data-app-theme'):'no-shell')+' body='+getComputedStyle(document.body).backgroundColor;})()`);
const dbt = async () => (await db.user.findUnique({ where: { id: s.user.id }, select: { themePreference: true } as any }) as any)?.themePreference;
await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(11000);
console.log("start: " + await T() + " db=" + await dbt());
await p.locator('button:has-text("Тёмная")').first().click(); await p.waitForTimeout(4000);
console.log("after switch on /mini/me: " + await T() + " db=" + await dbt());
for (const u of ["/dashboard", "/settings/appearance", "/journals", "/mini/sections"]) {
  await p.goto(s.base + u, { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(8000);
  console.log("  " + u + ": " + await T());
  await shot(p, "th-" + u.replace(/[^a-z0-9]/gi,"_"));
}
await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(7000);
console.log("back on /mini/me: " + await T() + " db=" + await dbt());
await p.reload({ waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(7000);
console.log("after reload /mini/me: " + await T());
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(8000);
console.log("dashboard after reload cycle: " + await T());
await shot(p, "th-final-dashboard");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
