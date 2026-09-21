import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const pend = await db.journalTaskClaim.findFirst({ where: { organizationId: "e2e-org-a", verificationStatus: "pending", journalCode: "product_writeoff" }, orderBy: { completedAt: "desc" } });
  console.log("проверяемая задача:", pend?.id, pend?.scopeLabel);
  const head = await openTelegramSession({ role: "headA", width: 390, height: 844, theme: "light" });
  const hp = head.page;
  await hp.goto(head.base + "/verifications", { timeout: 300000 }); await sleep(hp, 9000);
  const r = await hp.evaluate(`fetch('/api/verifications/${pend!.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject',comment:'ZZ3 нет причины списания'})}).then(async r=>r.status+' '+(await r.text()).slice(0,300))`);
  console.log("POST reject:", r);
  console.log("в базе:", JSON.stringify(await db.journalTaskClaim.findUnique({ where: { id: pend!.id }, select: { status: true, verificationStatus: true, verifierComment: true, completionData: true } })).slice(0,400));
  await hp.reload({ timeout: 300000 }); await sleep(hp, 8000);
  await shot(hp, "27-after-reject", true);
  console.log("экран:", ((await hp.evaluate(T)) as string).slice(0, 900));
  console.log("ERRORS", JSON.stringify(head.errors.slice(0,10)));
  await head.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
