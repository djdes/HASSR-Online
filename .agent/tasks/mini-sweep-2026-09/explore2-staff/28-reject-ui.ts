import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
const T = `document.body.innerText`;
(async () => {
  const cook = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const cp = cook.page;
  await cp.goto(cook.base + "/mini/today", { timeout: 300000 }); await sleep(cp, 5000);
  await releaseActive(cp);
  const c = await claimScope(cp, "traceability_test", "");
  const cid = c.res.j?.claim?.id;
  await cp.goto(cook.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(cp, 8000);
  await cp.locator("input:not([type=file])").nth(0).fill("ZZ3 партия 77");
  await cp.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Заверш/.test(b.innerText.trim()));b&&b.click();})()`);
  await sleep(cp, 5000);
  console.log("задача сдана:", JSON.stringify(await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true, verificationStatus: true } })));
  await cook.close();

  const head = await openTelegramSession({ role: "headA", width: 390, height: 844, theme: "light" });
  const hp = head.page;
  await hp.goto(head.base + "/verifications", { timeout: 300000 }); await sleep(hp, 10000);
  await hp.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Прослеживаемость/.test(b.innerText));b&&b.click();})()`);
  await sleep(hp, 3000);
  const ph = hp.locator('input[placeholder^="Комментарий"]');
  console.log("поле комментария найдено:", await ph.count());
  await ph.first().fill("ZZ3 переделать: партия не та");
  await sleep(hp, 500);
  await hp.locator('button', { hasText: /^Переделать$/ }).first().scrollIntoViewIfNeeded();
  await hp.locator('button', { hasText: /^Переделать$/ }).first().click();
  await sleep(hp, 6000);
  const row = await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true, verificationStatus: true, verifierComment: true } });
  console.log("после Переделать:", JSON.stringify(row));
  await shot(hp, "28-head-after-reject", true);
  console.log("экран заведующей:", ((await hp.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 400));
  await head.close();

  const cook2 = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const c2 = cook2.page;
  await c2.goto(cook2.base + "/mini/today", { timeout: 300000 }); await sleep(c2, 10000);
  console.log("=== Сегодня у повара ===\n" + ((await c2.evaluate(T)) as string).slice(0, 800));
  await shot(c2, "28-cook-today", false);
  const my: any = await c2.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
  console.log("активная:", JSON.stringify(my).slice(0, 300));
  if (my?.claim?.id) {
    await c2.goto(cook2.base + "/mini/claim/" + my.claim.id, { timeout: 300000 }); await sleep(c2, 7000);
    console.log("=== экран задачи после отказа ===\n" + ((await c2.evaluate(T)) as string).slice(0, 700));
    await shot(c2, "28-cook-claim-after-reject", true);
  }
  await cook2.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
