import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep } from "./lib";
const ID = "cmuagsm9u0002n09mtasrfozw";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-staff/";
const T = `document.body.innerText`;
(async () => {
  await db.journalObligation.update({ where: { id: ID }, data: { claimedById: state.users.cookA.id, claimedAt: new Date() } });
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/bonus/" + ID, { timeout: 300000 }); await sleep(p, 6000);
  await shot(p, "14-bonus", true);
  console.log("=== премия ===\n" + ((await p.evaluate(T)) as string).slice(0, 1200));
  // попытка отправить без фото
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/забрать|Готово|Отправ/i.test(b.innerText));return b?(b.click(),'клик '+b.innerText.trim()+' disabled='+b.disabled):'нет кнопки';})()`).then(r=>console.log("без фото:", r));
  await sleep(p, 2500);
  console.log("после:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 400));
  // фото
  await p.locator('input[type=file]').first().setInputFiles(SHOT + "t.png"); await sleep(p, 4000);
  await p.locator('textarea, input[type=text]').first().fill("ZZ3 заметка о премии").catch(()=>console.log("нет поля заметки"));
  await shot(p, "14-bonus-photo", true);
  console.log("с фото:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 600));
  const r1 = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/забрать|Готово|Отправ/i.test(b.innerText));return b?(b.click(),'клик '+b.innerText.trim()):'нет кнопки';})()`);
  console.log("отправка:", r1); await sleep(p, 5000);
  console.log("после отправки URL", p.url(), "\n", ((await p.evaluate(T).catch(()=>"?")) as string).replace(/\n+/g," | ").slice(0, 500));
  await shot(p, "14-bonus-sent", true);
  console.log("BonusEntry:", JSON.stringify(await db.bonusEntry.findMany({ where: { obligationId: ID } })).slice(0, 600));
  // повторная отправка
  await p.goto(s.base + "/mini/bonus/" + ID, { timeout: 300000 }); await sleep(p, 5000);
  console.log("повторный заход:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 500));
  await shot(p, "14-bonus-again", true);
  const r2 = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/забрать|Готово|Отправ/i.test(b.innerText));return b?(b.click(),'клик '+b.innerText.trim()):'нет кнопки';})()`);
  console.log("повторная отправка:", r2); await sleep(p, 5000);
  console.log("BonusEntry после 2:", JSON.stringify(await db.bonusEntry.findMany({ where: { obligationId: ID } })).slice(0, 700));
  console.log("Entries:", (await db.journalEntry.count({ where: { organizationId: "e2e-org-a", templateId: (await db.journalTemplate.findUnique({where:{code:"zz3_bonus_probe"}}))!.id } })));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
