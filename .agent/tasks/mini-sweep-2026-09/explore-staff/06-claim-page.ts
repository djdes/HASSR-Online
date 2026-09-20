import { openTelegramSession, db, state } from "../tg-session";
import { shot, DUMP } from "./lib";
(async () => {
  const uid = state.users.cookA.id;
  const c = await db.journalTaskClaim.findFirst({ where: { userId: uid, status: "active" } });
  if (!c) { console.log("no active claim"); process.exit(1); }
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/claim/" + c.id, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(6000);
  console.log(JSON.stringify(await p.evaluate(DUMP), null, 1));
  await shot(p, "cookA-claim-page");
  await shot(p, "cookA-claim-page-full", true);
  // inputs font-size check
  console.log("INPUTS", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('input,textarea,select')].map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return {type:e.type,name:e.name,ph:e.placeholder,fs:cs.fontSize,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})`), null, 1));
  console.log("TG back:", await p.evaluate(`window.__tgHost.backVisible`));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 800)); process.exit(1); });
