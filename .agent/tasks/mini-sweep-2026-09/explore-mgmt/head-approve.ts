import { openTelegramSession, BASE, db } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const T = `(function(){return (document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,900);})()`;
const TITLE = process.argv[2] || "Морозилка QR E2E — Утро";
const ACT = process.argv[3] || "Одобрить";
async function main() {
  const s = await openTelegramSession({ role: "headA", width: 360, height: 640 });
  const p = s.page;
  await p.goto(BASE + "/verifications", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(5000);
  await p.evaluate("(function(){var t=" + JSON.stringify(TITLE) + ";var b=[...document.querySelectorAll('button')].find(function(x){return x.innerText.indexOf(t)>=0}); if(b) b.click(); return !!b;})()");
  await p.waitForTimeout(4000);
  console.log("GUIDE AREA:", await p.evaluate(`(function(){var e=[...document.querySelectorAll("*")].find(function(x){return x.children.length===0 && /Загружаю|ГАЙД/.test(x.innerText||"")}); return e?e.parentElement.innerText.replace(/\s+/g," ").slice(0,400):"нет";})()`));
  await p.screenshot({ path: `${SHOTS}/head-approve-01-expanded.png`, fullPage: false });
  // комментарий
  const inp = p.locator('input[placeholder*="Комментарий"]').first();
  if (await inp.count()) { await inp.fill("Проверено тестом QA"); }
  await p.getByRole("button", { name: ACT }).first().click();
  await p.waitForTimeout(5000);
  console.log("AFTER:", await p.evaluate(T));
  await p.screenshot({ path: `${SHOTS}/head-approve-02-after.png`, fullPage: false });
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)], null, 1));
  const c = await db.journalTaskClaim.findMany({ where: { scopeLabel: TITLE, dateKey: new Date("2026-09-20T00:00:00.000Z") }, select: { id: true, status: true, verificationStatus: true, verifiedById: true, verifiedAt: true, verifierComment: true } });
  console.log("DB:", JSON.stringify(c, null, 1));
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
