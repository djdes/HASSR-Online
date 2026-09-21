import { openSite } from "./site";
import { go, probe, shot, SHOT } from "./lib";
import { clickText, listButtons } from "./dbl";
import { db } from "../tg-session";
import fs from "node:fs";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/reports", 5000);
await p.waitForFunction(`/Скачать PDF/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(4000);
console.log("btn states:", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('button')].filter(b=>/Скачать (PDF|Excel)/.test(b.innerText)).map(b=>b.innerText.trim()+' disabled='+b.disabled+' aria='+b.getAttribute('aria-disabled'))`)));
await clickText(p, "Выберите журнал"); await p.waitForTimeout(1500);
console.log("after combobox:\n" + (await probe(p)).bodyText.slice(-800));
await shot(p, "86-journal-combo");
const items = await p.evaluate(`[...document.querySelectorAll('[role=option],[role=menuitem],li,button')].filter(e=>e.getBoundingClientRect().width>0&&/Гигиенический журнал/.test(e.innerText)).map(e=>e.tagName+':'+e.innerText.trim().slice(0,40))`);
console.log("options", JSON.stringify(items).slice(0,400));
await p.evaluate(`(()=>{const e=[...document.querySelectorAll('[role=option],[role=menuitem],li,button')].filter(x=>x.getBoundingClientRect().width>0&&x.innerText.trim()==='Гигиенический журнал');if(e.length)e[0].click();return e.length})()`);
await p.waitForTimeout(2000);
console.log("btn states now:", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('button')].filter(b=>/Скачать (PDF|Excel)/.test(b.innerText)).map(b=>b.innerText.trim()+' disabled='+b.disabled)`)));
for (const label of ["Скачать PDF", "Скачать Excel"]) {
  const dl = p.waitForEvent("download", { timeout: 90000 }).catch(()=>null);
  await clickText(p, label).catch(e=>console.log("click err"));
  const d = await dl;
  if (d) { const path = SHOT + "/86-" + (d.suggestedFilename()||"f"); await d.saveAs(path); console.log(label, "->", d.suggestedFilename(), fs.statSync(path).size, "байт"); }
  else console.log(label, "-> НЕТ файла");
  await p.waitForTimeout(1500);
}
console.log("ERRORS", JSON.stringify(s.errors).slice(0,500));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
