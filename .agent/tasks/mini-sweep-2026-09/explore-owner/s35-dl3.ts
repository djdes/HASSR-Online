import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("download", async d => console.log("DOWNLOAD " + d.suggestedFilename()));
p.on("response", async r => { if (/\/api\/reports\//.test(r.url())) console.log("RES " + r.status() + " " + r.url().replace(s.base,"") + " ct=" + r.headers()["content-type"]); });
await p.goto(s.base + "/reports", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(14000);
const card = p.locator('div').filter({ hasText: "Скачать PDF" }).last();
// find the form container: use the select trigger with placeholder
await p.locator('button:has-text("Выберите журнал")').first().click(); await p.waitForTimeout(1500);
await p.locator('[role="option"]:has-text("Гигиенический журнал")').first().click(); await p.waitForTimeout(1200);
// the form's own date inputs are the last two before the buttons
const all = p.locator('input[type="date"]');
const n = await all.count();
console.log("date inputs " + n);
for (let i=0;i<n;i++) console.log("  date"+i+" y="+JSON.stringify((await all.nth(i).boundingBox())?.y)+" val="+await all.nth(i).inputValue());
const btnBox = await p.locator('button:has-text("Скачать PDF")').first().boundingBox();
console.log("pdf btn y=" + btnBox?.y);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
