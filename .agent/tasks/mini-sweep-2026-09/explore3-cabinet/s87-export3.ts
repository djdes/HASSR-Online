import { openSite } from "./site";
import { go, probe, shot, SHOT } from "./lib";
import { clickText } from "./dbl";
import { db } from "../tg-session";
import fs from "node:fs";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
for (const [from, to, tag] of [["2026-09-01","2026-09-21","сданными"],["2025-01-01","2025-01-31","пустой"]] as const) {
  await go(p, s.base + "/reports", 5000);
  await p.waitForFunction(`/Скачать PDF/.test(document.body.innerText)`, undefined, { timeout: 180000 });
  await p.waitForTimeout(4000);
  await clickText(p, "Выберите журнал"); await p.waitForTimeout(1200);
  await p.evaluate(`(()=>{const e=[...document.querySelectorAll('[role=option],div')].filter(x=>x.getBoundingClientRect().width>0&&x.innerText.trim()==='Гигиенический журнал');if(e.length)e[0].click();})()`);
  await p.waitForTimeout(1200);
  await p.evaluate(`(()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;const d=[...document.querySelectorAll('input[type=date]')];set.call(d[0],'${from}');d[0].dispatchEvent(new Event('input',{bubbles:true}));set.call(d[1],'${to}');d[1].dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await p.waitForTimeout(800);
  for (const label of ["Скачать PDF", "Скачать Excel"]) {
    const dl = p.waitForEvent("download", { timeout: 90000 }).catch(()=>null);
    await clickText(p, label).catch(()=>null);
    const d = await dl;
    if (d) { const path = SHOT + "/87-" + tag + "-" + (d.suggestedFilename()||"f"); await d.saveAs(path); console.log(tag, label, "->", d.suggestedFilename(), fs.statSync(path).size, "байт"); }
    else { const t = (await probe(p)).bodyText; const m = t.match(/Выберите журнал|Укажите дат[^\n]*|Ошибка[^\n]*|Нет данных[^\n]*/); console.log(tag, label, "-> НЕТ файла | сообщение:", m?.[0] ?? "—"); }
    await p.waitForTimeout(1500);
  }
}
console.log("ERRORS", JSON.stringify(s.errors).slice(0,600));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
