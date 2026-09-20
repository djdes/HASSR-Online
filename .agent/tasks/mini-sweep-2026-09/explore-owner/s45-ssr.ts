import { openTelegramSession } from "../tg-session";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 390, height: 844, theme: "light" });
const p = s.page;
for (let i=0;i<4;i++) {
  const b = s.errors.length;
  await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  await p.locator('header button[aria-label="Уведомления"]').click().catch(()=>console.log("no bell"));
  await p.waitForTimeout(4000);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1500);
  console.log("iter " + i + " errors: " + JSON.stringify(s.errors.slice(b).map(x=>x.slice(0,120))));
}
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
