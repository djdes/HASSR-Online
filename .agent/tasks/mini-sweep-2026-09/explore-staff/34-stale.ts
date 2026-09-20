import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  console.log("node now", new Date().toISOString());
  const c = await db.journalTaskClaim.findFirst({ where: { userId: state.users.cleanerA.id, status: "active" }, select: { id: true, dateKey: true, scopeLabel: true } });
  console.log("active claim", JSON.stringify(c));
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  const t = await T(p);
  console.log("HEAD", t.slice(0, 900));
  await shot(p, "cleaner-today-nextday");
  // is the banner clickable?
  console.log("LINKS", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('a')].map(a=>({h:a.getAttribute('href'),t:(a.innerText||'').replace(/\s+/g,' ').slice(0,40)})).slice(0,12)`)));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
