import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const cl = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a", userId: state.users.cleanerA.id, status: { in: ["active","completed"] } }, orderBy: { claimedAt: "desc" }, take: 3, select: { journalCode: true, scopeLabel: true, status: true, dateKey: true } });
  console.log("задачи уборщицы:", JSON.stringify(cl));
  const s = await openTelegramSession({ role: "headA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/control-board", { timeout: 300000 }); await sleep(p, 12000);
  // карточка уборщицы
  const card = await p.evaluate(String.raw`(()=>{const d=[...document.querySelectorAll('div')].filter(e=>/Ольга Уборщица/.test(e.innerText)&&e.innerText.length<200);return d.length?d[d.length-1].innerText.replace(/\s+/g,' '):'нет карточки';})()`);
  console.log("карточка уборщицы на панели:", card);
  // тыкнуть сотрудника без Telegram
  const r = await p.evaluate(String.raw`(()=>{const cards=[...document.querySelectorAll('div')].filter(e=>/Нет Telegram|без Telegram/.test(e.innerText)&&e.querySelector('button'));if(!cards.length)return 'нет карточек без Telegram';const b=cards[cards.length-1].querySelector('button');b.scrollIntoView({block:'center'});b.click();return 'клик по «'+b.innerText.trim()+'» у '+cards[cards.length-1].innerText.split('\n')[0];})()`);
  console.log("тык без Telegram:", r); await sleep(p, 5000);
  await shot(p, "41-nudge-no-tg");
  console.log("результат:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 300));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
