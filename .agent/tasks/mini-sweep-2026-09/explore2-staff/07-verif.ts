import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "headA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  console.log("после входа:", p.url());
  await p.goto(s.base + "/verifications", { timeout: 300000 }); await sleep(p, 8000);
  await shot(p, "07-verif-top");
  const txt = (await p.evaluate(`document.body.innerText`)) as string;
  console.log("=== /verifications ===\n" + txt.slice(0, 2500));
  // раскрыть первую карточку
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Морозилка|Холодильник/.test(b.innerText));b&&b.click();})()`);
  await sleep(p, 3000);
  await shot(p, "07-verif-expanded", true);
  const t2 = (await p.evaluate(`document.body.innerText`)) as string;
  const i = t2.indexOf("Введённые данные");
  console.log("=== карточка ===\n" + t2.slice(Math.max(0,i-400), i+1800));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
