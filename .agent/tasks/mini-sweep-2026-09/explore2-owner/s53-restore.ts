import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
const UID = "cmuagc7we00q8cc9m9xkg98zx";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    // 1) вернуть журнал
    await go(page, s.base + "/journals", 9000);
    const w = page.waitForResponse((r:any)=>r.request().method()!=="GET"&&r.url().includes("/api"), { timeout: 120000 }).catch(()=>null);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Включить'); if(b) b.click();}`);
    await page.waitForTimeout(2500);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>/^Включить журнал$|^Да,/.test(b.innerText.trim())); if(b) b.click();}`);
    const rr = await w; if (rr) console.log("ON", rr.status(), rr.request().method());
    await page.waitForTimeout(3000);
    console.log("ORG", JSON.stringify(await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } })));
    // 2) карточка сотрудника ZZ2 — отпуск/архив
    await go(page, s.base + "/settings/users", 8000);
    await page.evaluate(`(() => { for (const tr of document.querySelectorAll('tr,li,div')) { if(tr.children.length>6) continue; } const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='ZZ2 Новичок QR'); if(el){ el.scrollIntoView({block:'center'}); } })()`);
    await page.waitForTimeout(800);
    const btns = await page.evaluate(`(() => { const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='ZZ2 Новичок QR'); let p=el; for(let k=0;k<5;k++){ p=p.parentElement; const bs=[...p.querySelectorAll('button,a')]; if(bs.length>1) return bs.map(b=>(b.tagName)+':'+(b.getAttribute('aria-label')||b.title||b.innerText||'?').slice(0,40)); } return 'нет'; })()`);
    console.log("ROW-BTNS", JSON.stringify(btns));
    await page.evaluate(`(() => { const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='ZZ2 Новичок QR'); let p=el; for(let k=0;k<5;k++){ p=p.parentElement; const bs=[...p.querySelectorAll('button')].filter(b=>/Редактировать сотрудника/.test(b.getAttribute('aria-label')||b.title||'')); if(bs.length){ bs[0].click(); return; } } })()`);
    await page.waitForTimeout(3500);
    await shot(page, "53-emp-card", true);
    console.log("CARD", (await page.evaluate(`document.body.innerText`) as string).slice(-1800));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")).slice(-24), null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();
