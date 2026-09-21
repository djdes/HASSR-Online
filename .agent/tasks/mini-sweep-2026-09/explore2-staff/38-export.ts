import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "managerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/reports", { timeout: 300000 }); await sleep(p, 11000);
  // пустая форма → что видит человек
  await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Скачать PDF/.test(b.innerText));b.scrollIntoView({block:'center'});b.click();})()`);
  await sleep(p, 2500);
  await shot(p, "38-empty-error");
  console.log("пустая форма →", ((await p.evaluate(T)) as string).slice(-700));
  // выбираем журнал
  await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Выберите журнал/.test(b.innerText));b&&b.scrollIntoView({block:'center'});b&&b.click();})()`);
  await sleep(p, 2000); await shot(p, "38-journal-picker");
  console.log("после выбора журнала:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 500));
  const pick = await p.evaluate(String.raw`(()=>{const o=[...document.querySelectorAll('[role=option],li,button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>50&&/Гигиен/.test(e.innerText)});if(!o.length)return 'нет вариантов';o[0].click();return 'выбрал: '+o[0].innerText.replace(/\s+/g,' ').slice(0,40);})()`);
  console.log(pick); await sleep(p, 1500);
  await p.evaluate(String.raw`(()=>{const f=document.body;const d=[...f.querySelectorAll('input[type=date]')].slice(-2);if(d[0]){d[0].value='2026-09-01';d[0].dispatchEvent(new Event('input',{bubbles:true}));d[0].dispatchEvent(new Event('change',{bubbles:true}));}if(d[1]){d[1].value='2026-09-21';d[1].dispatchEvent(new Event('input',{bubbles:true}));d[1].dispatchEvent(new Event('change',{bubbles:true}));}})()`);
  await sleep(p, 1200);
  for (const n of ["PDF", "Excel"]) {
    const dl = p.waitForEvent("download", { timeout: 90000 }).catch(() => null);
    await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Скачать ${n}');b&&b.click();})()`);
    const d = await dl;
    console.log(n, "→", d ? d.suggestedFilename() : "НЕТ ФАЙЛА");
    await sleep(p, 3000);
    await shot(p, "38-after-" + n);
  }
  console.log("экран:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 400));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
