import fs from "node:fs";
import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const URLS = process.env.URLS!.split(",");
const C = fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09/explore-owner/contrast2.js", "utf8");
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 390, height: 844, theme: (process.env.THEME as any)||"dark" });
for (const u of URLS) {
  await s.page.goto(s.base + u, { waitUntil: "load", timeout: 300000 }).catch(()=>{});
  await s.page.waitForTimeout(Number(process.env.WAIT||8000));
  console.log("### " + u);
  for (const i of (await s.page.evaluate(C)) as string[]) console.log("   " + i);
  await shot(s.page, (process.env.THEME||"dark") + "-c-" + u.replace(/[^a-z0-9]/gi,"_"));
}
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
