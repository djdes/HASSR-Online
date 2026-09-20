import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const s = await openTelegramSession({ role: "managerA", width: 360, height: 640 });
  const p = s.page;
  await p.goto(BASE + "/settings/users", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(7000);
  await p.evaluate(`(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.indexOf("Несколько сразу")>=0}); b.click();})()`);
  await p.waitForTimeout(3000);
  console.log(await p.evaluate(`(function(){
    var ov=[].slice.call(document.querySelectorAll("div")).filter(function(x){var cs=getComputedStyle(x);return cs.position==="fixed" && parseInt(cs.zIndex||"0")>=40 && x.getBoundingClientRect().height>200;});
    return ov.map(function(x){var r=x.getBoundingClientRect();return "top="+Math.round(r.top)+" bottom="+Math.round(r.bottom)+" h="+Math.round(r.height)+" z="+getComputedStyle(x).zIndex+" «"+x.innerText.replace(/\s+/g," ").slice(0,50)+"»"});
  })()`));
  await p.screenshot({ path: SHOTS + "/bulk-add.png", fullPage: false });
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
