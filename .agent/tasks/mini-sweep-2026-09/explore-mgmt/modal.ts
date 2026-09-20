import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const [role, path, label, tag] = process.argv.slice(2);
  const s = await openTelegramSession({ role, width: 360, height: 640 });
  const p = s.page;
  await p.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(6000);
  const ok = await p.evaluate("(function(){var t=" + JSON.stringify(label) + ";var b=[].slice.call(document.querySelectorAll('button,a')).find(function(x){return x.innerText.replace(/\s+/g,' ').trim().indexOf(t)>=0}); if(!b) return 'нет кнопки'; b.scrollIntoView({block:'center'}); b.click(); return 'ok';})()");
  console.log("click:", ok);
  await p.waitForTimeout(3500);
  const geom = await p.evaluate(`(function(){
    var ds = [].slice.call(document.querySelectorAll("[role=dialog]"));
    if (!ds.length) return "нет модалки; scrollY=" + window.scrollY + "; overlays=" + document.querySelectorAll("[data-state=open]").length;
    var d = ds[ds.length-1];
    var r = d.getBoundingClientRect();
    var nav = document.querySelector("nav") ? document.querySelector("nav").getBoundingClientRect() : null;
    var last = [].slice.call(d.querySelectorAll("button")).pop();
    var lr = last ? last.getBoundingClientRect() : null;
    return "n=" + ds.length + " scrollY=" + window.scrollY + " text=" + d.innerText.replace(/\s+/g," ").slice(0,80) + " | dialog top=" + Math.round(r.top) + " bottom=" + Math.round(r.bottom) + " h=" + Math.round(r.height) +
      " | vh=" + window.innerHeight + " | navTop=" + (nav ? Math.round(nav.top) : "нет") +
      " | lastBtn=" + (lr ? Math.round(lr.top) + ".." + Math.round(lr.bottom) + " «" + last.innerText.slice(0,20) + "»" : "нет");
  })()`);
  console.log(geom);
  await p.screenshot({ path: `${SHOTS}/modal-${tag}.png`, fullPage: false });
  await p.screenshot({ path: `${SHOTS}/modal-${tag}-full.png`, fullPage: true });
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
