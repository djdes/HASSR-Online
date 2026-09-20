import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
const URLS = process.env.URLS!.split(",");
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
for (const u of URLS) {
  const before = s.errors.length;
  let st = "?";
  try { const r = await s.page.goto(s.base + u, { waitUntil: "load", timeout: 300000 }); st = String(r?.status()); } catch(e){ st="ERR"; }
  await s.page.waitForTimeout(Number(process.env.WAIT||7000));
  const pr: any = await probe(s.page);
  const body = pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ");
  const bad = pr.url !== u ? "  ->REDIRECTED TO " + pr.url : "";
  const empty = body.replace(/W \/ [^/]+\/ ?1? ?\/ ?/, "").length < 80 ? "  EMPTY?" : "";
  console.log(u + " [" + st + "] " + JSON.stringify(pr.heads[0]||"") + bad + empty);
  if (bad || empty) { console.log("    body: " + body.slice(0,400)); await shot(s.page, "st-" + u.replace(/[^a-z0-9]/gi,"_")); }
  const e = s.errors.slice(before); if (e.length) console.log("    !! " + JSON.stringify(e.slice(0,4)));
}
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
