import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "headA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/settings/journals", { timeout: 300000 }); await sleep(p, 8000);
  const cur = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } });
  console.log("текущие выключенные:", JSON.stringify(cur));
  const r = await p.evaluate(`fetch('/api/settings/journals',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({disabledCodes:['zz3_bonus_probe']})}).then(async r=>r.status+' '+(await r.text()).slice(0,200))`);
  console.log("PATCH под заведующей:", r);
  const after = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } });
  console.log("стало:", JSON.stringify(after));
  if (JSON.stringify(after) !== JSON.stringify(cur)) {
    await db.organization.update({ where: { id: "e2e-org-a" }, data: { disabledJournalCodes: cur!.disabledJournalCodes as never } });
    console.log("вернул как было");
  }
  // клик по реальному переключателю на странице
  const click = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button,[role=switch],input[type=checkbox]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0});return b.slice(0,14).map(e=>({t:(e.innerText||'').replace(/[\n]+/g,' ').slice(0,34),role:e.getAttribute('role'),dis:e.disabled}));})()`);
  console.log("контролы страницы:", JSON.stringify(click));
  // страница прав
  await p.goto(s.base + "/settings/permissions", { timeout: 300000 }); await sleep(p, 8000);
  await shot(p, "21-permissions-head", true);
  const c2 = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0});return b.slice(0,20).map(e=>(e.innerText||'').replace(/[\n]+/g,' ').slice(0,34));})()`);
  console.log("кнопки на /settings/permissions:", JSON.stringify(c2));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
