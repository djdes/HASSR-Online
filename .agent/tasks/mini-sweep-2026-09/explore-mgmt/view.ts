// Снимки без fullPage + прокрутка: npx tsx view.ts <role> <w> <theme> <tag> <path> [scrolls]
import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
async function main() {
  const [role, w, theme, tag, p0, sc] = process.argv.slice(2);
  const scrolls = Number(sc || 1);
  const s = await openTelegramSession({ role, width: Number(w), height: Number(w) === 360 ? 640 : 844, theme: theme as any });
  const p = s.page;
  await p.goto(BASE + p0, { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(4500);
  for (let i = 0; i < scrolls; i++) {
    await p.screenshot({ path: `${SHOTS}/${tag}-${i}.png`, fullPage: false });
    await p.evaluate(`window.scrollBy(0, Math.round(window.innerHeight*0.8))`);
    await p.waitForTimeout(700);
  }
  const btns = await p.evaluate(`[...document.querySelectorAll("button,a[href]")].map(function(b){return (b.tagName==="A"?"A "+b.getAttribute("href")+" ":"BTN ")+b.innerText.replace(/\s+/g," ").trim().slice(0,50)}).filter(function(x,i,a){return a.indexOf(x)===i}).slice(0,120)`);
  console.log((btns as string[]).join("\n"));
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)], null, 1));
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
