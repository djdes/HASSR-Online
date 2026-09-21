import { openTelegramSession, db } from "../tg-session";
import { shot, sleep, DUMP } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 4000);
  console.log("RELEASE", JSON.stringify(await releaseActive(p)));
  const c = await claimScope(p, "cold_equipment_control", "Холодильник QR E2E — Утро");
  console.log("CLAIM", JSON.stringify(c.res).slice(0, 500), "| scope", c.scope.scopeKey);
  const cid = c.res.j?.claim?.id;
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 6000);
  await shot(p, "03-cold-top");
  await shot(p, "03-cold-full", true);
  const d: any = await p.evaluate(DUMP);
  console.log("=== BODY ===\n" + d.body);
  console.log("=== CONTROLS ===", d.btns.map((b:any)=>`${b.tag}/${b.type}:${b.txt}`).join(" | "));
  // Завершить без отметок
  await p.getByRole("button", { name: /Завершить/ }).first().click();
  await sleep(p, 2500);
  console.log("=== после пустого Завершить ===\n" + ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g," ").slice(0,800));
  await shot(p, "03-cold-empty");
  // отметить один шаг и завершить
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Возьми термометр'));b&&b.click();})()`);
  await sleep(p, 500);
  await p.getByRole("button", { name: /Завершить/ }).first().click();
  await sleep(p, 3500);
  console.log("URL после завершения", p.url());
  console.log("=== после завершения ===\n" + ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g," ").slice(0,600));
  await shot(p, "03-cold-done");
  const row = await db.journalTaskClaim.findUnique({ where: { id: cid } });
  console.log("=== DB CLAIM ===", JSON.stringify(row, null, 1).slice(0, 1500));
  const capa = await db.capaTicket.findMany({ where: { organizationId: "e2e-org-a", sourceType: "journal-claim" }, orderBy: { createdAt: "desc" }, take: 2 });
  console.log("=== CAPA ===", JSON.stringify(capa.map(c=>({t:c.title,at:c.createdAt}))));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
