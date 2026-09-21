import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
const T = `document.body.innerText`;
const CLICK = (re: string) => `(()=>{const b=[...document.querySelectorAll('button')].find(b=>${re}.test(b.innerText.trim()));return b?(b.click(),'клик: '+b.innerText.trim()+' disabled='+b.disabled):'нет кнопки';})()`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 4000);

  // --- 1. Офлайн → снова онлайн, повторный тап без перезагрузки
  await releaseActive(p);
  let c = await claimScope(p, "glass_control", "");
  let cid = c.res.j?.claim?.id;
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 7000);
  await p.locator("input:not([type=file])").first().fill("ZZ3 стаканы");
  await s.ctx.setOffline(true); await sleep(p, 1500);
  console.log("офлайн клик:", await p.evaluate(CLICK("/^Заверш/")));
  await sleep(p, 4000);
  await s.ctx.setOffline(false); await sleep(p, 2500);
  console.log("после возврата связи (сам не ушёл?):", JSON.stringify(await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true } })));
  console.log("онлайн клик:", await p.evaluate(CLICK("/^Заверш/")));
  await sleep(p, 4000);
  console.log("итог:", JSON.stringify(await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true, completionData: true } })).slice(0,300));

  // --- 2. Двойной тап «Завершить»
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 4000);
  await releaseActive(p);
  c = await claimScope(p, "metal_impurity", "");
  cid = c.res.j?.claim?.id;
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 7000);
  await p.locator("input:not([type=file])").first().fill("ZZ3 фарш");
  const before = await db.journalTaskClaim.count({ where: { organizationId: "e2e-org-a", journalCode: "metal_impurity" } });
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Запис/.test(b.innerText.trim()));b.click();b.click();b.click();})()`);
  await sleep(p, 6000);
  const after = await db.journalTaskClaim.count({ where: { organizationId: "e2e-org-a", journalCode: "metal_impurity" } });
  console.log("двойной тап: claim'ов было", before, "стало", after, "| URL", p.url());
  console.log("экран:", ((await p.evaluate(T).catch(()=>"?")) as string).replace(/\n+/g," | ").slice(0,300));

  // --- 3. «Сегодня не требуется»
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 4000);
  await releaseActive(p);
  c = await claimScope(p, "pest_control", "");
  cid = c.res.j?.claim?.id;
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 7000);
  console.log("skip кнопка:", await p.evaluate(CLICK("/Сегодня не требуется/")));
  await sleep(p, 1500); await shot(p, "16-skip-form", true);
  console.log("форма пропуска:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0,400));
  console.log("пропустить:", await p.evaluate(CLICK("/Пропустить/")));
  await sleep(p, 4000);
  console.log("после пропуска:", JSON.stringify(await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true, verificationStatus: true, completionData: true } })));

  // --- 4. «Вернуть задачу»
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 4000);
  await releaseActive(p);
  c = await claimScope(p, "ppe_issuance", "");
  cid = c.res.j?.claim?.id;
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 7000);
  console.log("вернуть:", await p.evaluate(CLICK("/Вернуть задачу/")));
  await sleep(p, 1500); await shot(p, "16-release-dialog", true);
  console.log("окно:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0,600));
  console.log("подтвердить:", await p.evaluate(CLICK("/^Вернуть задачу$/")));
  await sleep(p, 4000);
  console.log("после возврата URL", p.url(), JSON.stringify(await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true } })));
  await shot(p, "16-after-release");
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
