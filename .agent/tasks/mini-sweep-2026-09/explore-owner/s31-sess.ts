import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
const URLS = process.env.URLS!.split(",");
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
for (const u of URLS) {
  const before = s.errors.length;
  await p.goto(s.base + u, { waitUntil: "load", timeout: 300000 }).catch(()=>{});
  await p.waitForTimeout(10000);
  const pr: any = await probe(p);
  console.log("### " + u + " -> " + pr.url);
  const e = s.errors.slice(before);
  if (e.length) { console.log("   !! " + JSON.stringify(e.slice(0,3))); await shot(s.page, "err-" + u.replace(/[^a-z0-9]/gi,"_")); }
  // reload too
  const b2 = s.errors.length;
  await p.reload({ waitUntil: "load", timeout: 300000 }).catch(()=>{});
  await p.waitForTimeout(9000);
  const e2 = s.errors.slice(b2);
  if (e2.length) console.log("   [reload] !! " + JSON.stringify(e2.slice(0,3)));
}
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
