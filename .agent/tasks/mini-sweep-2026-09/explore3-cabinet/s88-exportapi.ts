import { openSite } from "./site";
import { go } from "./lib";
import { db } from "../tg-session";
import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-cabinet";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/reports", 4000);
await p.waitForTimeout(6000);
for (const [u, name] of [
  ["/api/reports/excel?templateCode=hygiene&from=2026-09-01&to=2026-09-21","excel-full.xlsx"],
  ["/api/reports/pdf?template=hygiene&from=2026-09-01&to=2026-09-21","pdf-full.pdf"],
  ["/api/reports/excel?templateCode=hygiene&from=2025-01-01&to=2025-01-31","excel-empty.xlsx"],
  ["/api/reports/pdf?template=hygiene&from=2025-01-01&to=2025-01-31","pdf-empty.pdf"],
] as const) {
  const t0 = Date.now(); const r = await p.request.get(s.base + u, { timeout: 180000 });
  const buf = await r.body().catch(()=>Buffer.alloc(0));
  console.log(name, "ms", Date.now()-t0, "status", r.status(), "type", r.headers()["content-type"], "size", buf.length, buf.length<400 ? "| body: "+buf.toString().slice(0,200) : "");
  if (r.status()===200 && buf.length>0) fs.writeFileSync(SHOT + "/88-" + name, buf);
}
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
