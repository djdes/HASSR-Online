import { openSite } from "./site";
import { go, probe, shot } from "./lib";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
for (let i=0;i<3;i++){ const r = await p.request.get(s.base + "/orders", { maxRedirects: 0 }); console.log("request.get /orders =>", r.status()); }
for (let i=0;i<2;i++){
  await go(p, s.base + "/orders", 5000); await p.waitForTimeout(8000);
  const pr = await probe(p);
  console.log("browser /orders =>", pr.url, "|", pr.bodyText.slice(0,200).replace(/\n/g," | "));
}
await shot(p, "79-orders");
// и под заведующей
console.log("ERRORS", JSON.stringify(s.errors).slice(0,500));
await s.close();
const h = await openSite({ role: "headA", width: 1280, height: 900 });
for (const u of ["/orders","/mercury","/reports","/bonuses"]) { const r = await h.page.request.get(h.base + u, { maxRedirects: 0 }); console.log("headA", u, "=>", r.status()); }
await h.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
