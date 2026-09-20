import fs from "node:fs";
import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const PROBE = `(function(){
  var vw = document.documentElement.clientWidth;
  var bad = [];
  var all = document.querySelectorAll("main *");
  for (var i=0;i<all.length;i++){
    var el = all[i]; var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 2 || r.left < -2) {
      var s = getComputedStyle(el);
      if (s.overflowX === "auto" || s.overflowX === "scroll") continue;
      var p = el.parentElement; var skip = false;
      while (p) { var ps = getComputedStyle(p); if (ps.overflowX === "auto" || ps.overflowX === "scroll" || ps.overflowX === "hidden") { skip = true; break; } p = p.parentElement; }
      if (skip) continue;
      bad.push(el.tagName + "." + String(el.className).slice(0,50) + " L" + Math.round(r.left) + " R" + Math.round(r.right) + " «" + (el.innerText||"").replace(/\s+/g," ").slice(0,40) + "»");
    }
  }
  return { vw: vw, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0,6) };
})()`;
async function main() {
  const role = process.argv[2];
  const theme = (process.argv[3] as any) || "light";
  const paths = process.argv.slice(4);
  const s = await openTelegramSession({ role, width: 360, height: 640, theme });
  for (const path of paths) {
    await s.page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 300000 });
    await s.page.waitForTimeout(4000);
    let r: any; try { r = await s.page.evaluate(PROBE); } catch { await s.page.waitForTimeout(3000); r = await s.page.evaluate(PROBE); }
    const flag = r.scrollW > r.vw + 2 || r.bad.length ? "!!" : "ok";
    console.log(`${flag} ${path} vw=${r.vw} scrollW=${r.scrollW}` + (r.bad.length ? "\n   " + r.bad.join("\n   ") : ""));
    if (flag === "!!") await s.page.screenshot({ path: `${SHOTS}/ovf-${role}-${theme}-${path.replace(/\W+/g,"_")}.png`, fullPage: false });
  }
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)].slice(0,5), null, 1));
  await s.close();
}
main().catch(e => { console.error(e); process.exit(1); });
