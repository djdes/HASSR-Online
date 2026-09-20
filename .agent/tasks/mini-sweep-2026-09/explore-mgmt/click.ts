// npx tsx click.ts <role> <w> <theme> <path> <buttonText> <tag>
import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const [role, w, theme, p0, label, tag] = process.argv.slice(2);
  const s = await openTelegramSession({ role, width: Number(w), height: Number(w) === 360 ? 640 : 844, theme: theme as any });
  const p = s.page;
  const net: string[] = [];
  p.on("response", (r) => { if (r.request().method() !== "GET" && !/_next/.test(r.url())) net.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await p.goto(BASE + p0, { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(4500);
  const ok = await p.evaluate("(function(){var t=" + JSON.stringify(label) + ";var b=[...document.querySelectorAll('button')].find(function(x){return x.innerText.replace(/\s+/g,' ').trim().indexOf(t)>=0}); if(!b) return false; b.scrollIntoView({block:'center'}); b.click(); return true;})()");
  console.log("clicked:", ok);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${SHOTS}/${tag}.png`, fullPage: false });
  console.log("NET:", JSON.stringify(net, null, 1));
  console.log("TOAST:", await p.evaluate(`(function(){var l=document.querySelector("[data-sonner-toaster]");return l?l.innerText.replace(/\s+/g," "):"нет"})()`));
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)], null, 1));
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
