import fs from "node:fs";
import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const URLS = process.env.URLS!.split(",");
const CONTRAST = fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09/explore-owner/contrast.js", "utf8");
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 390, height: 844, theme: "dark" });
for (const u of URLS) {
  await s.page.goto(s.base + u, { waitUntil: "load", timeout: 300000 }).catch(()=>{});
  await s.page.waitForTimeout(Number(process.env.WAIT||8000));
  const c: any = await s.page.evaluate(CONTRAST);
  await shot(s.page, "dk-" + u.replace(/[^a-z0-9]/gi,"_"));
  console.log("### " + u + " bodyBg=" + c.bodyBg);
  for (const i of c.items) console.log("   " + i);
}
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
