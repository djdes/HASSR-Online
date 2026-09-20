import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  await p.locator(`header button[aria-label="AI помощник"]`).click();
  await p.waitForTimeout(3000);
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Закрыть'||/^×$/.test(b.innerText)); b&&b.click()})()`);
  await p.waitForTimeout(4000);
  await shot(p, "ai-sheet");
  await p.locator('a[data-nav-href="/mini/sections"]').click();
  await p.waitForTimeout(5000);
  console.log("AI still open?", (await T(p)).includes("технолог"), "| body style", await p.evaluate(`document.body.getAttribute('style')`), "| scroll", await p.evaluate(`(()=>{window.scrollTo(0,200);return scrollY})()`));
  await shot(p, "ai-after-nav");
  // skip dialog (no bell)
  const c = await db.journalTaskClaim.findFirst({ where: { userId: state.users.cookA.id, status: "active" } });
  if (c) {
    await p.goto(s.base + "/mini/claim/" + c.id, { waitUntil: "load", timeout: 300000 });
    await p.waitForTimeout(8000);
    await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Сегодня не требуется/.test(b.innerText)); b&&b.scrollIntoView({block:'center'})})()`);
    await p.waitForTimeout(600);
    await p.getByRole("button", { name: /Сегодня не требуется/ }).first().click();
    await p.waitForTimeout(3000);
    await shot(p, "skip-clean");
    console.log("skip block geometry", await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>/Пропустить|Отмена/.test(b.innerText)).map(b=>{const r=b.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {t:b.innerText.trim(),y:Math.round(r.y),covered:!(b===t||b.contains(t)),by:t?t.tagName+'|'+(t.innerText||'').slice(0,20):'null'}});return JSON.stringify(b)})()`));
  }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
