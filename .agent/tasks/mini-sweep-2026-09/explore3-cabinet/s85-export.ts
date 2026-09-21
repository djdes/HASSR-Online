import { openSite } from "./site";
import { go, probe, shot, SHOT } from "./lib";
import { clickText } from "./dbl";
import { db } from "../tg-session";
import fs from "node:fs";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/reports", 5000);
await p.waitForFunction(`/Скачать PDF/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(4000);
// выбрать журнал (гигиена) в селекте
const opts = await p.evaluate(`[...document.querySelectorAll('select')].map(s=>[...s.options].map(o=>o.text).slice(0,6))`);
console.log("SELECTS", JSON.stringify(opts));
await p.selectOption('select >> nth=0', { index: 1 }).catch(e=>console.log("sel err", String(e).slice(0,80)));
await p.waitForTimeout(1500);
for (const label of ["Скачать PDF", "Скачать Excel"]) {
  const dl = p.waitForEvent("download", { timeout: 120000 }).catch(()=>null);
  await clickText(p, label).catch(e=>console.log("click err", String(e).slice(0,100)));
  const d = await dl;
  if (d) { const path = SHOT + "/85-" + label.replace(/\s/g,"_") + "-" + (d.suggestedFilename()||"f"); await d.saveAs(path); const st = fs.statSync(path); console.log(label, "->", d.suggestedFilename(), st.size, "байт"); }
  else { console.log(label, "-> НЕТ файла"); console.log("  body:", (await probe(p)).bodyText.slice(0,200).replace(/\n/g," | ")); }
  await p.waitForTimeout(2000);
}
console.log("ERRORS", JSON.stringify(s.errors).slice(0,500));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
