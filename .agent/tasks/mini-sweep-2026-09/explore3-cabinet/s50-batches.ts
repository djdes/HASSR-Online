import { openSite } from "./site";
import { shot, go, probe } from "./lib";
import { clickText, listButtons } from "./dbl";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
p.on("response", r => { if (r.status()>=400) console.log("  HTTP", r.status(), r.request().method(), r.url().replace(s.base,"")); });
for (let i=0;i<2;i++){
  await go(p, s.base + "/batches", 5000);
  await p.waitForTimeout(8000);
  console.log("attempt", i, "url", p.url(), "| text:", (await probe(p)).bodyText.slice(0,260).replace(/\n/g," | "));
}
await clickText(p, "Новая партия");
await p.waitForTimeout(9000);
console.log("after click url:", p.url());
console.log((await probe(p)).bodyText.slice(0,1200));
await shot(p, "50-batch-new", true);
console.log("ERRORS", JSON.stringify(s.errors).slice(0,700));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
