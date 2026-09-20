import { chromium } from "playwright";
import { state, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const w = Number(process.argv[2] || 360);
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ viewport: { width: w, height: 640 }, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.request.post(BASE + "/api/auth/login", { data: { email: (state as any).users.managerA.email, password: (state as any).password } });
  const p = await ctx.newPage();
  await p.goto(BASE + "/settings/users", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(7000);
  await p.evaluate(`(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.indexOf("Пригласить по QR")>=0}); b.scrollIntoView({block:"center"}); b.click();})()`);
  await p.waitForTimeout(3500);
  console.log(await p.evaluate(`(function(){
    var ds=[].slice.call(document.querySelectorAll("[role=dialog]"));
    if(!ds.length) return "нет модалки";
    var d=ds[ds.length-1]; var r=d.getBoundingClientRect();
    return "top="+Math.round(r.top)+" bottom="+Math.round(r.bottom)+" h="+Math.round(r.height)+" vh="+window.innerHeight+" scrollY="+window.scrollY+" text="+d.innerText.replace(/\s+/g," ").slice(0,60);
  })()`));
  await p.screenshot({ path: `${SHOTS}/modal-site-${w}.png`, fullPage: false });
  await br.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
