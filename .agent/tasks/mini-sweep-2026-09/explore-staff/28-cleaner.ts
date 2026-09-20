import { openTelegramSession, db, state } from "../tg-session";
import { shot, DUMP } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  await db.journalTaskClaim.deleteMany({ where: { userId: state.users.cleanerA.id } });
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  console.log("landed", p.url());
  await p.waitForTimeout(9000);
  const d: any = await p.evaluate(DUMP);
  console.log("BODY", d.body.slice(0, 1800));
  await shot(p, "cleanerA-today-390");
  // claim cleaning task
  const groups = await p.evaluate(`[...document.querySelectorAll('*')].filter(e=>/УБОРКА/.test(e.textContent||'')).length`);
  const clean = p.locator("div").filter({ hasText: /^Уборка ·/ }).first();
  const btn = p.getByRole("button", { name: "Взять" });
  // find the "Взять" inside the Уборка card
  const idx = await p.evaluate(`(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Взять');return bs.findIndex(b=>{const c=b.closest('div.flex');return c&&/Уборка/.test(c.innerText)})})()`);
  console.log("cleaning btn idx", idx, "total", await btn.count());
  if (typeof idx === "number" && idx >= 0) {
    await btn.nth(idx).scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
    await btn.nth(idx).click();
    await p.waitForTimeout(10000);
    console.log("URL", p.url());
    console.log("CLAIM TXT", (await T(p)).slice(0, 1500));
    await shot(p, "cleanerA-claim-pipeline");
    await shot(p, "cleanerA-claim-pipeline-full", true);
  }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
