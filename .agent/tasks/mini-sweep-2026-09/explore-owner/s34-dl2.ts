import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("download", d => console.log("DOWNLOAD " + d.suggestedFilename()));
await p.goto(s.base + "/reports", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(14000);
const btn = p.locator('button:has-text("Скачать PDF")').first();
await btn.scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
await btn.click(); await p.waitForTimeout(3000);
const info: any = await p.evaluate(`(()=>{
  const els=[...document.querySelectorAll('p')].filter(e=>/Выберите журнал|Укажите дату|Ошибка/.test(e.innerText));
  return els.map(e=>{const r=e.getBoundingClientRect(); return e.innerText+' top='+Math.round(r.top)+' vh='+window.innerHeight+' visible='+(r.top>0&&r.bottom<window.innerHeight);});
})()`);
console.log("ERROR MSG: " + JSON.stringify(info));
await shot(p, "dl2-after-click-nofill");
// now fill properly
await p.locator('button:has-text("Выберите журнал")').first().click(); await p.waitForTimeout(1500);
await shot(p, "dl2-select-open");
const opts: string[] = await p.evaluate(`(()=>[...document.querySelectorAll('[role="option"]')].map(o=>o.innerText.trim()).slice(0,10))()`);
console.log("options: " + JSON.stringify(opts));
if (opts.length) { await p.locator('[role="option"]').first().click(); await p.waitForTimeout(1200); }
const dates = p.locator('input[type="date"]');
console.log("date inputs: " + await dates.count());
await dates.nth(0).fill("2026-09-01");
await dates.nth(1).fill("2026-09-21");
await p.waitForTimeout(500);
await shot(p, "dl2-filled");
await p.locator('button:has-text("Скачать PDF")').first().click();
await p.waitForTimeout(12000);
await shot(p, "dl2-after-pdf");
const pr: any = await probe(p);
console.log("body tail: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(-12).join(" / "));
await p.locator('button:has-text("Скачать Excel")').first().click();
await p.waitForTimeout(12000);
await shot(p, "dl2-after-excel");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
