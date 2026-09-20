import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
const cases = ["+7 999 123 45 67", "89991234568", "9991234569"];
for (const [i, phone] of cases.entries()) {
  await p.goto(s.base + "/settings/users", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(i === 0 ? 12000 : 5000);
  const name = "ZZФон" + i + "_" + Date.now().toString().slice(-4);
  await p.locator('button[aria-label*="Добавить в «Повар»"]').click();
  await p.waitForTimeout(2500);
  await p.locator('input[placeholder*="ФИО"]').fill(name);
  const tel = p.locator('input[type="tel"]');
  await tel.click();
  await p.keyboard.type(phone, { delay: 40 });
  await p.waitForTimeout(600);
  const shown = await tel.inputValue();
  await shot(p, "ph" + i);
  await p.locator('div[data-slot="dialog-footer"] button:has-text("Добавить")').click();
  await p.waitForTimeout(5000);
  const u: any = await db.user.findFirst({ where: { name } });
  console.log("typed=" + JSON.stringify(phone) + " shownInField=" + JSON.stringify(shown) + " storedInDb=" + JSON.stringify(u?.phone));
}
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
