import { openTelegramSession, BASE, db } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const T = `(function(){return {url:location.pathname+location.search, txt:(document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,2500)};})()`;
async function main() {
  const theme = (process.argv[2] as any) || "light";
  const w = Number(process.argv[3] || 360);
  const s = await openTelegramSession({ role: "headA", width: w, height: w === 360 ? 640 : 844, theme });
  const p = s.page;
  await p.goto(BASE + "/verifications", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(5000);
  console.log("BEFORE:", JSON.stringify(await p.evaluate(T)));
  await p.screenshot({ path: `${SHOTS}/head-verif-${theme}-${w}-01.png`, fullPage: false });
  // раскрыть первую карточку "ждут проверки"
  const clicked = await p.evaluate(`(function(){
    var b=[...document.querySelectorAll("button")].find(function(x){return /Проверка здоровья смены/.test(x.innerText)});
    if(!b) return "no-card"; b.click(); return b.innerText.replace(/\s+/g," ").slice(0,120);
  })()`);
  console.log("clicked:", clicked);
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `${SHOTS}/head-verif-${theme}-${w}-02-expanded.png`, fullPage: false });
  console.log("EXPANDED:", JSON.stringify(await p.evaluate(T)));
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
