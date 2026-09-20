import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
const STAMP = Date.now().toString().slice(-5);
const NAME = "ZZ Пётр Тестов " + STAMP;
const PHONE = "+7999" + STAMP + "11";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method() !== "GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,220)); });
await p.goto(s.base + "/settings/users", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
// "Добавить" under Повар group
const addButtons = p.locator('button:has-text("Добавить в")');
console.log("add-in buttons:", await addButtons.count());
await p.locator('button[aria-label*="Добавить в «Повар»"]').click();
await p.waitForTimeout(2500);
await shot(p, "u4-add-emp");
console.log("fields " + JSON.stringify(await p.evaluate(FIELDS)));
await p.locator('input[placeholder*="ФИО"]').fill(NAME);
await p.locator('input[type="tel"]').fill(PHONE);
await p.waitForTimeout(400);
await shot(p, "u5-add-emp-filled");
await p.locator('button:has-text("Добавить")').last().click();
await p.waitForTimeout(6000);
await shot(p, "u6-after-add");
const pr: any = await probe(p);
console.log("after: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(0,30).join(" / ").slice(0,800));
const u: any = await db.user.findFirst({ where: { name: { contains: "ZZ Пётр Тестов " + STAMP } } });
console.log("DB user: " + JSON.stringify(u && { id: u.id, name: u.name, phone: u.phone, role: u.role, position: u.position, email: u.email, isActive: u.isActive, archivedAt: u.archivedAt }));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
