import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const s = await openTelegramSession({ role: "headA", width: 360, height: 640, theme: "dark" });
  const p = s.page;
  await p.goto(BASE + "/verifications", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(5000);
  await p.evaluate(`(function(){var b=[...document.querySelectorAll('button')].find(function(x){return x.innerText.indexOf("Проверка здоровья смены")>=0}); if(b) b.click();})()`);
  await p.waitForTimeout(3000);
  await p.evaluate(`document.querySelector('input[placeholder*="Комментарий"]').scrollIntoView({block:"center"})`);
  await p.waitForTimeout(800);
  await p.screenshot({ path: SHOTS + "/head-dark-panel.png", fullPage: false });
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
