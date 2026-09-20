import { openTelegramSession, BASE, db } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const T = `(function(){return {url:location.pathname+location.search, txt:(document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,2500)};})()`;
async function main() {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844 });
  const p = s.page;
  await p.goto(BASE + "/mini/today", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(4000);
  console.log("TODAY:", JSON.stringify(await p.evaluate(T)));
  // открыть карточку "в работе"
  {
    const b = p.getByRole("button", { name: /^Завершить$/ }).first();
    await b.scrollIntoViewIfNeeded();
    console.log("finish btn", await b.count());
    await b.click();
    await p.waitForTimeout(6000);
    console.log("AFTER FINISH:", JSON.stringify(await p.evaluate(T)));
    await p.screenshot({ path: SHOTS + "/cook-03-after-finish.png", fullPage: false });
  }
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)], null, 1));
  const claims = await db.journalTaskClaim.findMany({ where: { userId: (s.user as any).id }, orderBy: { claimedAt: "desc" }, take: 5 });
  console.log("CLAIMS:", JSON.stringify(claims, null, 1).slice(0, 2500));
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
