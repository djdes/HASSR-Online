import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const s = await openTelegramSession({ role: "managerA", width: 360, height: 640 });
  const p = s.page;
  await p.goto(BASE + "/settings/equipment", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(6000);
  await p.evaluate(`(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.indexOf("Добавить")>=0}); b.click();})()`);
  await p.waitForTimeout(2500);
  console.log(await p.evaluate(`(function(){
    var d=document.querySelector("[role=dialog]");
    var sc=[].slice.call(d.querySelectorAll("*")).filter(function(x){var cs=getComputedStyle(x);return (cs.overflowY==="auto"||cs.overflowY==="scroll") && x.scrollHeight>x.clientHeight+4;});
    var last=[].slice.call(d.querySelectorAll("button")).pop();
    return "scrollables=" + sc.length + " dialogOverflowY=" + getComputedStyle(d).overflowY + " dialogScrollH=" + d.scrollHeight + "/" + d.clientHeight + " lastBtnTop=" + Math.round(last.getBoundingClientRect().top);
  })()`));
  // пробуем прокрутить внутри
  await p.evaluate(`(function(){var d=document.querySelector("[role=dialog]"); d.scrollTop = 9999; var sc=[].slice.call(d.querySelectorAll("*")).filter(function(x){var cs=getComputedStyle(x);return cs.overflowY==="auto"||cs.overflowY==="scroll";}); sc.forEach(function(x){x.scrollTop=9999});})()`);
  await p.waitForTimeout(1200);
  console.log("после прокрутки внутри:", await p.evaluate(`(function(){var d=document.querySelector("[role=dialog]");var last=[].slice.call(d.querySelectorAll("button")).pop();var r=last.getBoundingClientRect();return "lastBtn " + Math.round(r.top) + ".." + Math.round(r.bottom) + " vh=" + window.innerHeight;})()`));
  await p.screenshot({ path: SHOTS + "/eq-sheet-scrolled.png", fullPage: false });
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
