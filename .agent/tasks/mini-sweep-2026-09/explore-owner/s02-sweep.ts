import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
const URLS = process.env.URLS!.split(",");
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: (process.env.THEME as any) || "light" });
for (const u of URLS) {
  const before = s.errors.length;
  let status = "?";
  try {
    const r = await s.page.goto(s.base + u, { waitUntil: "load", timeout: 300000 });
    status = String(r?.status());
  } catch (e) { status = "ERR " + String(e).slice(0,120); }
  await s.page.waitForTimeout(Number(process.env.WAIT||6000));
  const p: any = await probe(s.page);
  const name = u.replace(/[^a-z0-9]/gi, "_");
  await shot(s.page, "sw-" + name);
  console.log("### " + u + "  status=" + status + "  landed=" + p.url);
  console.log("   header: " + JSON.stringify(p.heads));
  console.log("   activeNav: " + p.navs.filter((n:string)=>n.includes("*")).join(","));
  console.log("   overflowX=" + p.overflow + (p.wide.length ? "  WIDE=" + JSON.stringify(p.wide) : ""));
  console.log("   text: " + p.bodyText.split("\n").slice(0,14).join(" / ").slice(0,500));
  const errs = s.errors.slice(before);
  if (errs.length) console.log("   !! " + JSON.stringify(errs.slice(0,6)));
}
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
