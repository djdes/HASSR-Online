import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
const FIN = `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Завершить');if(!b)return 'нет кнопки';b.click();return 'клик';})()`;
const TXT = `document.body.innerText.replace(/\s+/g,' ')`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 4000);
  await releaseActive(p);
  const c = await claimScope(p, "cold_equipment_control", "Холодильник QR E2E — Утро");
  const cid = c.res.j?.claim?.id ?? c.res.j?.existing?.id;
  console.log("claim", cid, c.res.s);
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 5000);
  // A. Завершить без единой отметки
  console.log("клик1", await p.evaluate(FIN)); await sleep(p, 3000);
  console.log("A) после пустого:", ((await p.evaluate(TXT)) as string).slice(0, 900));
  await shot(p, "04-empty-submit");
  // B. отметить один шаг → Завершить
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Возьми термометр'));b&&b.click();})()`);
  await sleep(p, 400);
  console.log("клик2", await p.evaluate(FIN)); await sleep(p, 4000);
  console.log("B) URL", p.url());
  console.log("B) текст:", ((await p.evaluate(TXT)) as string).slice(0, 700));
  await shot(p, "04-after-finish");
  await sleep(p, 3000);
  const row = await db.journalTaskClaim.findUnique({ where: { id: cid } });
  console.log("DB:", JSON.stringify({ status: row?.status, vs: row?.verificationStatus, completedAt: row?.completedAt, data: row?.completionData }).slice(0, 1200));
  const capa = await db.capaTicket.count({ where: { organizationId: "e2e-org-a", sourceType: "journal-claim" } });
  console.log("CAPA count", capa);
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
