import { openSite } from "./site";
import { shot, go, probe } from "./lib";
import { clickText, listButtons } from "./dbl";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1400, height: 950 });
const p = s.page;
await go(p, s.base + "/settings/users", 6000);
await p.waitForFunction(`/График отпусков/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(4000);
for (const tab of ["График отпусков", "График больничных", "График увольнений", "График выходных дней"]) {
  await clickText(p, tab); await p.waitForTimeout(3000);
  const t = (await probe(p)).bodyText;
  const i = t.indexOf(tab);
  console.log("=== " + tab + " ===");
  console.log(t.slice(i, i+700).replace(/\n/g," | "));
  await shot(p, "63-" + tab.replace(/\s/g,"_"));
}
console.log("ERRORS", JSON.stringify(s.errors).slice(0,400));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
