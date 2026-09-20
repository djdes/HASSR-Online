import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const role = process.argv[2] || "managerA";
  const s = await openTelegramSession({ role, width: 390, height: 844 });
  const p = s.page;
  const nav: string[] = [];
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) nav.push(f.url().replace(BASE, "").split("#")[0]); });
  await p.goto(BASE + "/mini/me", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(4500);
  console.log("ДОЛЖНОСТЬ:", await p.evaluate(`(function(){var d=[].slice.call(document.querySelectorAll("dt,dd")).map(function(x){return x.innerText.trim()});return d.join(" | ")})()`));
  await p.evaluate(`(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.indexOf("Выйти")>=0}); b.scrollIntoView({block:"center"}); b.click();})()`);
  await p.waitForTimeout(3000);
  console.log("DIALOG:", await p.evaluate(`(function(){var d=document.querySelector("[role=dialog]");return d?d.innerText.replace(/\s+/g," "):"нет"})()`));
  await p.screenshot({ path: `${SHOTS}/logout-1-confirm-${role}.png`, fullPage: false });
  await p.evaluate(`(function(){var d=document.querySelector("[role=dialog]"); if(!d) return; var b=[].slice.call(d.querySelectorAll("button")).filter(function(x){return x.innerText.indexOf("Отмена")<0}).pop(); if(b) b.click();})()`);
  await p.waitForTimeout(12000);
  console.log("nav:", JSON.stringify(nav));
  console.log("после выхода:", p.url().replace(BASE, ""));
  console.log("cookie:", await p.evaluate(`document.cookie`));
  console.log("txt:", await p.evaluate(`(document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,300)`));
  await p.screenshot({ path: `${SHOTS}/logout-2-after-${role}.png`, fullPage: false });
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)], null, 1));
  await s.close();
}
main().catch(e => { console.error(e); process.exit(1); });
