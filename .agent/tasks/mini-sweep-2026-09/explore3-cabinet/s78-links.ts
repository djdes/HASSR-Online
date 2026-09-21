import { openSite } from "./site";
import { go, probe } from "./lib";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
const hrefs = new Set<string>();
for (const u of ["/settings", "/mini/sections", "/dashboard"]) {
  await go(p, s.base + u, 5000); await p.waitForTimeout(7000);
  const hs: string[] = await p.evaluate(`[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>h&&h.startsWith('/'))`);
  hs.forEach(h=>hrefs.add(h.split("#")[0]));
  console.log(u, "links:", hs.length);
}
console.log("unique:", hrefs.size);
const bad: string[] = [];
for (const h of [...hrefs]) {
  const r = await p.request.get(s.base + h, { maxRedirects: 0 }).catch(()=>null);
  const st = r ? r.status() : 0;
  if (st >= 400) bad.push(st + " " + h);
}
console.log("BAD LINKS:", JSON.stringify(bad, null, 1));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
