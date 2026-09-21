import { openSite } from "./site";
import { shot, go, probe, CLICKABLES, FIELDS } from "./lib";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
for (const url of ["/capa", "/settings/areas", "/settings/products", "/batches", "/plans", "/changes", "/losses"]) {
  await go(p, s.base + url, 5000);
  await p.waitForTimeout(7000);
  const pr = await probe(p);
  console.log("=== " + url + " === overflow", pr.overflow);
  console.log(pr.bodyText.slice(0, 700).replace(/\n/g," | "));
  console.log("BUTTONS", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('button,a[href]')].filter(b=>b.getBoundingClientRect().width>0).map(b=>b.innerText.trim()).filter(t=>t&&t.length<40).slice(0,30)`)));
}
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
