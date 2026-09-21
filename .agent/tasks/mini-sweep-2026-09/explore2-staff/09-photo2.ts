import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-staff/";
const AROUND = `(()=>{const el=[...document.querySelectorAll('div')].find(d=>d.innerText.startsWith('Сфотографируй результат'));return el?el.innerText:'нет шага';})()`;
(async () => {
  const s = await openTelegramSession({ role: "cleanerA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  const my: any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
  const cid = my?.claim?.id;
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 5000);
  const fi = p.locator('input[type=file]').first();
  const scrollTo = `(()=>{const el=[...document.querySelectorAll('div')].find(d=>d.innerText.startsWith('Сфотографируй результат'));el&&el.scrollIntoView({block:'center'});})()`;
  for (const [name, file] of [["gif", "t.gif"], ["big", "big.jpg"], ["png", "t.png"]] as const) {
    await fi.setInputFiles(SHOT + file); await sleep(p, 5000);
    await p.evaluate(scrollTo); await sleep(p, 500);
    console.log(`--- ${name} ---\n` + (await p.evaluate(AROUND)));
    await shot(p, "09-" + name);
  }
  // удалить фото
  await p.evaluate(`(()=>{const b=document.querySelector('button[aria-label="Удалить фото"]');b&&b.click();})()`);
  await sleep(p, 1500); await p.evaluate(scrollTo); await sleep(p, 500);
  console.log("--- после удаления ---\n" + (await p.evaluate(AROUND)));
  await shot(p, "09-deleted");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
