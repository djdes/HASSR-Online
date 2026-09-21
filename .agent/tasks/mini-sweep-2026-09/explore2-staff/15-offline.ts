import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 4000);
  await releaseActive(p);
  const c = await claimScope(p, "disinfectant_usage", "");
  const cid = c.res.j?.claim?.id;
  console.log("claim", cid, JSON.stringify(c.res).slice(0,150));
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 9000);
  console.log("страница:", ((await p.evaluate(T)) as string).slice(0,300));
  await p.locator("input:not([type=file])").first().fill("ZZ3 Средство");
  // обрываем связь
  await s.ctx.setOffline(true);
  await sleep(p, 2500);
  console.log("=== офлайн, до отправки ===\n" + ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 700));
  await shot(p, "15-offline-before");
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Заверш/.test(b.innerText.trim()));b&&b.click();})()`);
  await sleep(p, 5000);
  console.log("=== после Завершить без связи ===\n" + ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 700));
  await shot(p, "15-offline-submit", true);
  // перезагрузка без связи
  await p.reload({ timeout: 60000 }).catch(e => console.log("reload упал:", String(e).slice(0,100)));
  await sleep(p, 3000);
  console.log("=== перезагрузка без связи ===\n" + ((await p.evaluate(T).catch(()=>"нет доступа")) as string).replace(/\n+/g," | ").slice(0, 400));
  await shot(p, "15-offline-reload");
  // связь вернулась
  await s.ctx.setOffline(false);
  await sleep(p, 2000);
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 5000);
  console.log("=== связь вернулась ===\n" + ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 600));
  await shot(p, "15-online-again");
  const row = await db.journalTaskClaim.findUnique({ where: { id: cid }, select: { status: true, completionData: true } });
  console.log("в базе:", JSON.stringify(row));
  // outbox
  await p.goto(s.base + "/mini/outbox", { timeout: 300000 }); await sleep(p, 5000);
  console.log("=== /mini/outbox ===\n" + ((await p.evaluate(T)) as string).slice(0, 700));
  await shot(p, "15-outbox", true);
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
