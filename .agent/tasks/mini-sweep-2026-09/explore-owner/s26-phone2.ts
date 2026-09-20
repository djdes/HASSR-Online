import { openTelegramSession } from "../tg-session";
import { shot, FIELDS } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(s.base + "/settings/phone", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
console.log("fields " + JSON.stringify(await p.evaluate(FIELDS)));
const tel = p.locator('input[type="tel"], input[inputmode="tel"]').first();
if (await tel.count()) {
  await tel.click();
  await p.keyboard.type("+7 999 123 45 67", { delay: 40 });
  await p.waitForTimeout(500);
  console.log("settings/phone shows: " + JSON.stringify(await tel.inputValue()));
  await shot(p, "ph-settings");
  await tel.fill("");
  await tel.click();
  await p.keyboard.type("89991234567", { delay: 40 });
  await p.waitForTimeout(500);
  console.log("settings/phone (8...) shows: " + JSON.stringify(await tel.inputValue()));
}
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
