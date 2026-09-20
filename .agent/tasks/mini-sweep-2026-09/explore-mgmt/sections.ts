import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const out: Record<string, any> = {};
  for (const role of (process.argv[2]||"headA,cookA").split(",")) {
    const s = await openTelegramSession({ role, width: 390, height: 844 });
    await s.page.goto(BASE + "/mini/sections", { waitUntil: "domcontentloaded", timeout: 300000 });
    await s.page.waitForTimeout(4500);
    const h1 = await s.page.evaluate(`(function(){var h=document.querySelector("h1");return (h?h.innerText:"")+" || url="+location.pathname})()`); console.log("H1:", h1);
    const items = await s.page.evaluate(`[].slice.call(document.querySelectorAll("main a")).map(function(a){return a.getAttribute("href") + " :: " + a.innerText.replace(/\s+/g," ").trim().slice(0,60)})`);
    out[role] = items;
    console.log("\n## " + role + " (" + (items as string[]).length + ")");
    console.log((items as string[]).join("\n"));
    await s.page.screenshot({ path: `${SHOTS}/sections-${role}.png`, fullPage: false });
    await s.browser.close();
  }
  require("node:fs").writeFileSync("D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09/explore-mgmt/sections.json", JSON.stringify(out, null, 1));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
