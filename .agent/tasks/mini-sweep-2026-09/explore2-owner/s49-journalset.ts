import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/journals", 9000);
    const rows = await page.evaluate(`(() => { const out=[]; for (const e of document.querySelectorAll('*')) { if(e.children.length) continue; if(/металлопримес/i.test(e.textContent)) { let p=e; for(let k=0;k<6;k++) p=p.parentElement; out.push(String(p.className).slice(0,50)+' :: '+p.innerText.split(String.fromCharCode(10)).join(' | ').slice(0,200)); } } return out.slice(-2); })()`);
    console.log("ROW", JSON.stringify(rows, null, 1));
    const wait = page.waitForResponse((r:any)=>r.request().method()!=="GET"&&r.url().includes("/api"), { timeout: 120000 }).catch(()=>null);
    const clicked = await page.evaluate(`(() => { for (const e of document.querySelectorAll('*')) { if(e.children.length) continue; if(!/металлопримес/i.test(e.textContent)) continue; let p=e; for(let k=0;k<7;k++){ if(!p.parentElement) break; p=p.parentElement; const b=[...p.querySelectorAll('button,[role=switch],input[type=checkbox]')]; if(b.length){ b[b.length-1].click(); return b.map(x=>x.tagName+':'+(x.getAttribute('aria-label')||x.innerText||'').slice(0,30)+':'+x.getAttribute('aria-checked')); } } } return 'nothing'; })()`);
    console.log("CLICKED", JSON.stringify(clicked));
    await page.waitForTimeout(3000);
    await shot(page, "49-journals-toggle");
    console.log("AFTER", (await page.evaluate(`document.body.innerText`) as string).slice(0, 500));
    const rr = await wait; if (rr) console.log("RESP", rr.status(), rr.request().method(), rr.url().slice(-40), (await rr.text().catch(()=> "")).slice(0,150));
    await page.waitForTimeout(3000);
    console.log("ORG", JSON.stringify(await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } })));
    await go(page, s.base + "/dashboard", 6000);
    const t = (await page.evaluate(`document.body.innerText`) as string);
    console.log("DASH", (t.match(/Есть запись за сегодня[^\n]*/)||[])[0], "| металлопримеси в списке?", t.includes("металлопримесей"));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();
