import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "headA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/control-board", { timeout: 300000 }); await sleep(p, 12000);
  await shot(p, "40-control-board", true);
  const t = ((await p.evaluate(T)) as string);
  console.log("=== панель контроля ===\n" + t.slice(0, 2000));
  const btns = await p.evaluate(String.raw`(()=>[...document.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0}).map(e=>e.innerText.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,30))()`);
  console.log("кнопки:", JSON.stringify(btns));
  for (const name of ["Тыкнуть", "Напомнить всем", "Напомнить"]) {
    const r = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='${name}');return b?(b.scrollIntoView({block:'center'}),b.click(),'клик'):'нет кнопки «${name}»';})()`);
    console.log(name, "→", r);
    if (r === "клик") { await sleep(p, 5000); await shot(p, "40-" + name); console.log("   результат:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 350)); }
  }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
