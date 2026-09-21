import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
const IDS = { plain: "cmuagsm9e0001n09mywm36gfn", bonus: "cmuagsm9u0002n09mtasrfozw", foreignUser: "cmuagsma50003n09m20kqxp4p", foreignOrg: "cmuagsmaf0004n09mlfuaz7rw" };
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  for (const [name, id] of Object.entries(IDS)) {
    await p.goto(s.base + "/mini/o/" + id, { timeout: 300000 }).catch(e => console.log("goto err", String(e).slice(0,100)));
    await sleep(p, 5000);
    await p.waitForLoadState("domcontentloaded").catch(()=>null);
    await sleep(p, 6000);
    const shell = await p.evaluate(`!!document.querySelector('a[href="/mini/today"], a[href="/mini/sections"], a[href="/mini/me"]')`).catch(()=>"?");
    console.log(`--- ${name} (${id}) → ${p.url()} | оболочка: ${shell}`);
    console.log("   текст:", (((await p.evaluate(`document.body.innerText`).catch(()=>"<<нет>>")) as string)).replace(/\n+/g, " | ").slice(0, 400));
    await shot(p, "13-o-" + name);
    const row = await db.journalObligation.findUnique({ where: { id }, select: { openedAt: true, status: true } });
    console.log("   в базе:", JSON.stringify(row));
  }
  // bonus страница
  await p.goto(s.base + "/mini/bonus/" + IDS.bonus, { timeout: 300000 }); await sleep(p, 5000);
  console.log("--- /mini/bonus (не забрана) →", p.url());
  console.log("   текст:", (((await p.evaluate(`document.body.innerText`).catch(()=>"<<нет>>")) as string)).replace(/\n+/g, " | ").slice(0, 400));
  await shot(p, "13-bonus-unclaimed");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
