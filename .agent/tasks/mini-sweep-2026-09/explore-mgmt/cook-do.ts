import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const T = `(function(){return {url:location.pathname+location.search, txt:(document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,2000)};})()`;
const WANT = process.argv[3] || "Уборка · Склад сухих продуктов";
async function main() {
  const s = await openTelegramSession({ role: process.argv[2] || "cookA", width: 390, height: 844 });
  const p = s.page;
  await p.goto(BASE + "/mini/today", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(4000);
  const idx = await p.evaluate(`(function(){
    var want = ${JSON.stringify(WANT)};
    var bs = [...document.querySelectorAll("button")];
    for (var i=0;i<bs.length;i++){
      var b=bs[i]; if(b.innerText.trim()!=="Взять") continue;
      var n=b, hops=0;
      while(n && hops<8){ if((n.innerText||"").indexOf(want)>=0) return i; n=n.parentElement; hops++; }
    }
    return -1;
  })()`);
  console.log("index", idx);
  if (idx as any < 0) { await s.close(); return; }
  await p.locator("button", { hasText: "Взять" }).nth(0); // noop
  await p.evaluate(`[...document.querySelectorAll("button")][${idx}].click()`);
  await p.waitForTimeout(5000);
  console.log("after claim:", JSON.stringify(await p.evaluate(T), null, 1));
  await p.screenshot({ path: SHOTS + "/cook-01-after-claim.png", fullPage: false });
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)], null, 1));
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
