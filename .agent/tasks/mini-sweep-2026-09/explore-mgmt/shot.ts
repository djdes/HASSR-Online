// Снимки экранов под ролью: npx tsx shot.ts <role> <width> <theme> <tag> <path1> <path2> ...
import fs from "node:fs";
import { openTelegramSession, db, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const PROBE = `(function(){var h1=document.querySelector("h1");return {url:location.pathname+location.search,h1:h1?h1.innerText.trim():"",txt:(document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,1200)};})()`;
async function main() {
  const [role, w, theme, tag, ...paths] = process.argv.slice(2);
  fs.mkdirSync(SHOTS, { recursive: true });
  const s = await openTelegramSession({ role, width: Number(w), height: Number(w) === 360 ? 640 : 844, theme: theme as any });
  console.log("landed:", s.page.url());
  let i = 0;
  for (const p of paths) {
    i++;
    await s.page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 300000 });
    await s.page.waitForTimeout(3000);
    let pr: any; try { pr = await s.page.evaluate(PROBE); } catch { await s.page.waitForTimeout(3000); pr = await s.page.evaluate(PROBE); }
    const name = `${tag}-${String(i).padStart(2, "0")}-${p.replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}.png`;
    await s.page.screenshot({ path: `${SHOTS}/${name}`, fullPage: true });
    console.log("\n###", p, "->", pr.url, "|H1:", pr.h1, "|", name);
    console.log(pr.txt);
  }
  console.log("\nERRORS:", JSON.stringify([...new Set(s.errors)], null, 1));
  await s.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
