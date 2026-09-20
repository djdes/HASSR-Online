import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const CODE = `(function(){
  var out = [];
  var nodes = [].slice.call(document.querySelectorAll("div"));
  for (var i=0;i<nodes.length;i++){
    var el = nodes[i];
    if (el.children.length !== 0) continue;
    var t = (el.innerText||"").trim();
    if (!t) continue;
    if (t.indexOf("\u041d\u0415 \u0412\u0417\u042f\u0422\u041e") < 0 && t.indexOf("\u043f\u0440\u043e\u0445\u043b\u0430\u0436\u0434") < 0) continue;
    var cs = getComputedStyle(el);
    var par = el.parentElement, bg = "";
    while (par) { var ps = getComputedStyle(par); if (ps.backgroundColor && ps.backgroundColor !== "rgba(0, 0, 0, 0)") { bg = ps.backgroundColor; break; } par = par.parentElement; }
    out.push(t.slice(0,50) + " || color=" + cs.color + " || opacity=" + cs.opacity + " || bg=" + bg);
  }
  return out;
})()`;
async function main() {
  for (const theme of ["light", "dark"] as const) {
    const s = await openTelegramSession({ role: "headA", width: 360, height: 640, theme });
    await s.page.goto(BASE + "/control-board", { waitUntil: "domcontentloaded", timeout: 300000 });
    await s.page.waitForTimeout(6000);
    console.log("## " + theme);
    console.log(((await s.page.evaluate(CODE)) as string[]).join("\n"));
    await s.browser.close();
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
