import { openSite } from "./site";
import { go, probe, shot } from "./lib";
import { clickText } from "./dbl";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/settings/inspector-portal", 5000);
await p.waitForFunction(`/Создать ссылку/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(3000);
await clickText(p, "Создать ссылку"); await p.waitForTimeout(3000);
await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].filter(x=>/Создать/.test(x.innerText)&&x.getBoundingClientRect().width>0);b[b.length-1].click();})()`);
for (let i=0;i<14;i++){
  await p.waitForTimeout(1000);
  const t = await p.evaluate(`document.body.innerText`) as string;
  console.log(i+"s | Ссылка создана:", /Ссылка создана/.test(t), "| Скопировать URL:", /Скопировать URL/.test(t), "| форма:", /Создать ссылку для инспектора/.test(t));
  if (/Ссылка создана/.test(t)) { await shot(p, "83-success"); }
}
await shot(p, "83-end");
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
