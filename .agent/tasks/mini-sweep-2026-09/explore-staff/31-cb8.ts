import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
(async () => {
  const c = await db.journalTaskClaim.findFirst({ where: { userId: state.users.cleanerA.id, status: "active" } });
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) console.log("NAV", f.url().replace(s.base, "")); });
  await p.goto(s.base + "/mini/claim/" + c!.id, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  const info = await p.evaluate(`[...document.querySelectorAll('input[type=checkbox]')].map((e,i)=>{const l=e.closest('label');const r=e.getBoundingClientRect();return {i, txt:(l?l.innerText:'').replace(/\s+/g,' ').slice(0,40), y:Math.round(r.y+scrollY), w:Math.round(r.width)}})`);
  console.log("CHECKBOXES", JSON.stringify(info));
  for (let i = 0; i < (info as any[]).length; i++) {
    await p.evaluate(`(()=>{const e=document.querySelectorAll('input[type=checkbox]')[${i}];e.scrollIntoView({block:'center'});})()`);
    await p.waitForTimeout(400);
    const before = await p.evaluate(`document.querySelectorAll('input[type=checkbox]')[${i}].checked`);
    await p.locator("input[type=checkbox]").nth(i).click({ force: true, timeout: 8000 }).catch((e) => console.log(i, "clickerr", String(e).slice(0, 60)));
    await p.waitForTimeout(500);
    const after = await p.evaluate(`document.querySelectorAll('input[type=checkbox]')[${i}]?.checked`);
    console.log(i, (info as any[])[i].txt, before, "->", after, "| url", p.url().replace(s.base, ""));
    if (!p.url().includes("/mini/claim/")) break;
  }
  await shot(p, "cb-walk");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
