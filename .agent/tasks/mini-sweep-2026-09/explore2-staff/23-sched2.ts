import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "managerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/settings/schedule", { timeout: 300000 }); await sleep(p, 9000);
  // есть ли горизонтальная прокрутка у таблицы
  const scroll = await p.evaluate(String.raw`(()=>{const res=[];document.querySelectorAll('div,table').forEach(e=>{if(e.scrollWidth>e.clientWidth+4){const r=e.getBoundingClientRect();if(r.width>100)res.push({cls:(e.className+'').slice(0,60),sw:e.scrollWidth,cw:e.clientWidth,ovx:getComputedStyle(e).overflowX})}});return res.slice(0,6);})()`);
  console.log("прокручиваемые блоки:", JSON.stringify(scroll));
  // ставим выходной Ивану Повару на завтра (3-я ячейка его строки)
  const cell = await p.evaluate(String.raw`(()=>{const rows=[...document.querySelectorAll('tr')];const r=rows.find(r=>r.innerText.includes('Иван Повар'));if(!r)return 'нет строки';const b=[...r.querySelectorAll('button')];if(!b.length)return 'нет кнопок';b[0].click();return 'кликнул 1-ю ячейку, всего '+b.length;})()`);
  console.log("клик по ячейке:", cell);
  await sleep(p, 1500);
  await shot(p, "23-after-cell-click", true);
  console.log("после клика:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 300));
  // кликаем ещё раз — цикл статусов
  for (let i = 0; i < 3; i++) {
    await p.evaluate(String.raw`(()=>{const rows=[...document.querySelectorAll('tr')];const r=rows.find(r=>r.innerText.includes('Иван Повар'));const b=[...r.querySelectorAll('button')];b[0].click();})()`);
    await sleep(p, 700);
    const v = await p.evaluate(String.raw`(()=>{const rows=[...document.querySelectorAll('tr')];const r=rows.find(r=>r.innerText.includes('Иван Повар'));const b=[...r.querySelectorAll('button')];return b[0].innerText.trim()+' | title='+(b[0].getAttribute('title')||'')+' | aria='+(b[0].getAttribute('aria-label')||'');})()`);
    console.log("  статус после клика " + (i + 2) + ":", v);
  }
  // сохраняем
  const save = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Сохранить график/.test(b.innerText));return b?(b.click(),'клик, disabled='+b.disabled):'нет кнопки';})()`);
  console.log("сохранение:", save);
  await sleep(p, 5000);
  console.log("после сохранения:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 300));
  await shot(p, "23-saved", true);
  const sh = await db.workSchedule.findMany({ where: { userId: state.users.cookA.id }, orderBy: { date: "desc" }, take: 4 }).catch((e:any)=>"нет модели: "+String(e).slice(0,80));
  console.log("в базе:", JSON.stringify(sh).slice(0, 500));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
