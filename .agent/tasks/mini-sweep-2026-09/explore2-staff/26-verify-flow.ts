import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
const T = `document.body.innerText`;
const CLICK = (re: string) => String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>` + re + String.raw`.test(b.innerText.trim()));return b?(b.click(),'клик: '+b.innerText.trim()):'нет кнопки';})()`;
(async () => {
  // 1. повар делает задачу
  const cook = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const cp = cook.page;
  await cp.goto(cook.base + "/mini/today", { timeout: 300000 }); await sleep(cp, 5000);
  await releaseActive(cp);
  const c = await claimScope(cp, "product_writeoff", "");
  const cid = c.res.j?.claim?.id;
  console.log("claim повара:", cid, c.res.s);
  await cp.goto(cook.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(cp, 8000);
  const ins = cp.locator("input:not([type=file])");
  await ins.nth(0).fill("ZZ3 творог");
  await ins.nth(1).fill("2 кг");
  await ins.nth(3).fill("ZZ3 истёк срок");
  await cp.evaluate(CLICK("/^Запис/")); await sleep(cp, 5000);
  console.log("после записи:", cp.url(), JSON.stringify(await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true, verificationStatus: true, completionData: true } })).slice(0,300));
  await cook.close();

  // 2. заведующая отклоняет с причиной
  const head = await openTelegramSession({ role: "headA", width: 390, height: 844, theme: "light" });
  const hp = head.page;
  await hp.goto(head.base + "/verifications", { timeout: 300000 }); await sleep(hp, 9000);
  console.log("раскрыть:", await hp.evaluate(CLICK("/Списание продукции/")));
  await sleep(hp, 3000);
  await shot(hp, "26-verif-card", true);
  const card = ((await hp.evaluate(T)) as string);
  const i = card.indexOf("ВВЕДЁННЫЕ ДАННЫЕ");
  console.log("карточка:\n" + card.slice(Math.max(0,i-200), i + 700));
  // комментарий
  const ta = hp.locator("textarea, input[placeholder]");
  console.log("полей для комментария:", await ta.count());
  await ta.first().fill("ZZ3 переделать: не указана причина").catch(e=>console.log("не удалось заполнить", String(e).slice(0,80)));
  console.log("переделать:", await hp.evaluate(CLICK("/^Переделать$/")));
  await sleep(hp, 5000);
  const row = await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true, verificationStatus: true, verifierComment: true } });
  console.log("после отклонения:", JSON.stringify(row));
  await shot(hp, "26-after-reject", true);
  console.log("экран заведующей:", ((await hp.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 400));
  await head.close();

  // 3. что видит повар
  const cook2 = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const c2 = cook2.page;
  await c2.goto(cook2.base + "/mini/today", { timeout: 300000 }); await sleep(c2, 7000);
  console.log("=== Сегодня у повара после отказа ===\n" + ((await c2.evaluate(T)) as string).slice(0, 1000));
  await shot(c2, "26-cook-after-reject", true);
  const my: any = await c2.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
  console.log("активная задача повара:", JSON.stringify(my).slice(0, 300));
  await cook2.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
